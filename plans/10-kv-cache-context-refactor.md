# 10 — KV-Cache-Aligned Context Management

## Problem

The current design defeats Bedrock's KV-cache with three redundant, mutating injections per turn:

1. **50-findings list in dynamic system prompt** — paid at full price every call, even though findings are already in conversation history via `knowledge_add_finding` tool results.
2. **Plan summary in dynamic system prompt** — changes every turn as tasks complete, breaking the prefix cache key.
3. **Budget/context status in dynamic system prompt** — changes every turn by definition.

All three sit after the static cache point. Since the *entire dynamic section* changes every turn, the cache key for messages never matches. The result confirmed in traces: `cacheReadTokens` is stuck at 4637 (static system only) across all 14 steps, while `cacheWriteTokens` climbs to 35K — paying 1.25x each turn to write checkpoints that are never read.

Message pruning makes this worse: `buildMessages()` rewrites old tool results after 20 messages, mutating history and preventing message-level cache hits even if we added them.

## Root Cause

The Bedrock cache key is: `static_system + dynamic_system + tools + messages_prefix`. Any change to the dynamic system prompt invalidates the entire prefix including messages. With plan/budget/findings changing every turn, the prefix never matches.

## Fix: Make the system prompt fully static

Remove the dynamic section entirely. The model does not need this information re-injected — it has it:

- **Plan status**: visible in conversation history via `planning_update_status` tool results
- **Findings**: visible in conversation history via `knowledge_add_finding` tool results  
- **Budget/steps**: the model doesn't need to count tokens; it should research until done and let beast mode handle forced synthesis

With a static system prompt, the cache key is: `STATIC_SYSTEM + tools + messages_prefix`. The static section and tools never change. Only the messages prefix grows — and with explicit `cachePoint` markers in messages, that prefix is cached between turns too.

## Goal

1. Eliminate the dynamic system prompt so the prefix cache key is stable every turn.
2. Add explicit `cachePoint` markers inside messages so the growing conversation is cached.
3. Keep messages immutable so prefix matches hold.
4. Only compact (stub old tool results) when `inputTokens` approaches the 200K context window limit.

## Instructions

### 1. Eliminate the dynamic system prompt entirely

**File**: `src/llm/prompts.ts`

- Delete the `buildSystemPrompt` function entirely.
- Delete `formatFindingsList`, `formatFindingsSummary`, and any other dynamic-section helpers.
- The `SystemPrompt` type already supports `{ static, dynamic }` — we will now always pass `{ static: STATIC_SYSTEM }` with no `dynamic` field.
- `STATIC_SYSTEM` stays unchanged — it is the agent instructions and tool namespaces. Do not touch it.
- `buildBeastModePrompt` stays unchanged — it starts a fresh conversation and legitimately needs findings.
- `buildSubagentPrompt` stays unchanged.

### 2. Remove dynamic system prompt construction from the loop

**File**: `src/agent/loop.ts`

- Remove the `buildSystemPrompt` import and call.
- Remove the `formatFindingsList` import (and any related imports from prompts.ts).
- Remove `knowledgeStore.getFindings()` call used for the system prompt (keep the one used for beast mode).
- Remove `planStore.getPlanSummary()` call used for the system prompt (the plan store is still written to by tools — just stop reading it for the system prompt).
- Where `provider.chat(systemPrompt, ...)` is called, replace `systemPrompt` with `{ static: STATIC_SYSTEM }`.
- Import `STATIC_SYSTEM` directly from `prompts.ts`.
- The `stuckHint` / `toolHint` mechanism currently injected via the dynamic system prompt: move it into the conversation instead. When stuck is detected, append a synthetic user message to `messages`:
  ```
  { role: 'user', content: '[System guidance]: You have repeated the same action multiple times without new results. Try a different approach, different search queries, or move to a different subtask.' }
  ```
  Then append a synthetic assistant acknowledgement:
  ```
  { role: 'assistant', content: [{ type: 'text', text: 'Understood. I will change approach.' }] }
  ```
  This keeps alternation intact and puts the hint in the conversation where it belongs.

### 3. Add `cachePoint` injection to message preparation

**File**: `src/llm/bedrock.ts`

- In the `chat()` method, after converting messages with `toBedrockMessage()`, inject a `cachePoint` into the **second-to-last user message** in the Bedrock-formatted array.
- The messages array alternates `[user, assistant, ..., user_new]`. The last message is always the new user turn. Scan backwards from the end, skip the last message, find the first `role: 'user'` going backwards. Append `{ cachePoint: { type: 'default' } }` to its `content` array.
- Skip injection if fewer than 3 messages (no prior user turn to cache yet).
- Gate on `!system.noCachePoints` — same flag as system-block caching — so throwaway calls don't incur cache write charges.
- Do NOT mutate the input `messages` parameter. Clone/modify only the Bedrock-formatted array.
- This gives 3 cache points total: static system, tools, conversation prefix. Bedrock allows up to 4.

### 4. Replace message pruning with context-window-aware compaction

**File**: `src/agent/context.ts`

- Delete the `buildMessages()` function entirely.
- Create a new synchronous function:
  ```
  compactIfNeeded(messages: LLMMessage[], lastInputTokens: number, windowLimit: number): { messages: LLMMessage[]; compacted: boolean }
  ```
- Logic:
  - If `messages.length <= 12`: return `{ messages, compacted: false }` — nothing meaningful to compact.
  - If `lastInputTokens < windowLimit * 0.60`: return `{ messages, compacted: false }` — under threshold.
  - Otherwise: keep the first message (the original question) and the last 10 messages verbatim. For all messages in between, replace `tool_result` content blocks with `[Prior result — see findings]`. Preserve `is_error` on stubs. Return `{ messages: compacted, compacted: true }`.
- The 60% threshold (120K of 200K) provides a 80K buffer for one-turn lag plus worst-case growth.
- Returns a NEW array. Does not mutate input.

### 5. Track `lastInputTokens` in the loop and apply compaction

**File**: `src/agent/loop.ts`

- Add `let lastInputTokens = 0` before the while loop.
- Change `const messages` to `let messages`.
- After each `provider.chat()` returns, set `lastInputTokens = response.usage.input_tokens`.
- At the top of the loop body, AFTER the `budget.shouldSynthesize` check, apply compaction:
  ```
  const compactResult = compactIfNeeded(messages, lastInputTokens, config.contextWindow);
  if (compactResult.compacted) {
    messages = compactResult.messages;
    logger.warn({ step, lastInputTokens }, 'Context compacted — old tool results stubbed');
  }
  ```
- Remove the `buildMessages` call and import. Pass `messages` directly to `provider.chat()`.

### 6. Update config

**File**: `src/infra/config.ts`

- Remove `context.maxMessages` and `context.keepRecentMessages`.
- Add `contextWindow: 200_000` — the context window capacity limit, used for compaction threshold.
- Keep `tokenBudget: 200_000` unchanged — spend budget is a separate concept.

### 7. Remove budget context tracking (no longer needed)

**File**: `src/infra/budget.ts`

- Do NOT add `recordContextSize` or `contextTokens` — we no longer inject budget/context status into the system prompt, so the model doesn't need to see it. The budget tracker stays as-is: spend tracking only.

### 8. Raise the tool result truncation cap

**File**: `src/agent/context.ts`

- Change the truncation limit in `formatToolResult` from 1000 to 8000 chars.
- With message-level caching, old tool results cost 0.1x on subsequent turns. 8000 chars is sufficient for rich tool outputs without risk of unbounded content.

### 9. `toBedrockMessage` — no changes needed

The `cachePoint` is injected post-conversion (Step 3 operates on the Bedrock-formatted array). `toBedrockMessage` never encounters a cachePoint block.

### 10. Update tests

**File**: `src/agent/context.test.ts`

- Delete tests for `buildMessages`.
- Add tests for `compactIfNeeded`:
  - Under 60% threshold: returns original unchanged, `compacted: false`.
  - At/above 60% threshold with >12 messages: first kept, last 10 kept, middle tool_results stubbed, `compacted: true`.
  - `messages.length <= 12`: unchanged regardless of token count.

**File**: `src/llm/prompts.test.ts`

- Delete all tests for `buildSystemPrompt` and dynamic section helpers.
- Keep tests for `buildBeastModePrompt` and `buildSubagentPrompt`.

**File**: `src/llm/bedrock.test.ts`

- Add test: cachePoint injected into second-to-last user message when ≥3 messages.
- Add test: no cachePoint when <3 messages.
- Add test: `system.noCachePoints = true` → no cachePoint injected into messages.

### 11. Beast mode — no changes needed

`buildBeastModePrompt` starts a fresh single-message conversation with all findings packed in. It passes `{ static: STATIC_SYSTEM }` (already done in loop.ts). No changes.

## Verification

After implementation, run a research session and check the logs:

1. **`cacheReadTokens` must grow each step** — confirming message prefix hits. If it stays flat at the static-system-only value (~4637), something still changes in the prefix between turns.
2. **`cacheWriteTokens` should be large only on the first few turns** then plateau — once the prefix is established, fewer new tokens need caching.
3. **`inputTokens` should grow gradually** (conversation accumulates), not reset.
4. **Total `tokensTotal` for the same nuclear fusion question should be significantly below 108K** — the previous baseline without message caching.

## Files Changed

| File | Change |
|------|--------|
| `src/llm/prompts.ts` | Delete `buildSystemPrompt`, `formatFindingsList`, dynamic helpers |
| `src/llm/bedrock.ts` | Inject `cachePoint` into second-to-last user message; gate on `noCachePoints` |
| `src/agent/loop.ts` | Remove dynamic system prompt; use `{ static: STATIC_SYSTEM }` directly; move stuck hint into conversation messages; add compaction; track `lastInputTokens` |
| `src/agent/context.ts` | Delete `buildMessages`; add `compactIfNeeded` (60% threshold); raise truncation to 8000 |
| `src/infra/config.ts` | Remove old context config; add `contextWindow: 200_000` |
| Tests | Update to match |

## What NOT to change

- `STATIC_SYSTEM` — agent instructions, unchanged
- `buildBeastModePrompt` — fresh conversation, legitimately needs full findings
- `buildSubagentPrompt` — independent conversations, not affected
- `KnowledgeStore` — still used by beast mode and tools
- `BudgetTracker` — spend tracking stays as-is
- Tool config cache point in `bedrock.ts` — already correct

## Cache Point Budget

After this refactor we use 3 of Bedrock's 4 allowed cache points:
1. After static system prompt
2. After tool config
3. In the second-to-last user message (conversation prefix)

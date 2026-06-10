import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runAgent, type AgentResult } from '../src/agent/loop.js';
import { judgeReport, computeWeightedScore, DIMENSIONS, type Judgment } from './judge.js';
import { judgeSubagentStrategy, computeSubagentWeightedScore, SUBAGENT_DIMENSIONS, type SubagentJudgment } from './subagent-judge.js';

interface EvalCase {
  id: string;
  question: string;
  minWordCount: number;
  requiredTopics: string[];
  description: string;
  passThreshold?: number;
  delegationThreshold?: number;
}

const EVAL_CASES: EvalCase[] = [
  {
    id: 'nuclear-fusion',
    question: 'What is nuclear fusion and what are the current main approaches being pursued?',
    minWordCount: 500,
    requiredTopics: ['plasma', 'tokamak', 'inertial confinement', 'ITER', 'temperature'],
    description: 'Science topic with multiple subtopics',
    passThreshold: 3.0,
    delegationThreshold: 2.5,
  },
  {
    id: 'climate-economics',
    question: 'What are the economic costs of climate change according to recent research?',
    minWordCount: 400,
    requiredTopics: ['GDP', 'billion', 'damage', 'cost', 'economic'],
    description: 'Economic research requiring data sources',
    passThreshold: 3.0,
    delegationThreshold: 2.5,
  },
  {
    id: 'llm-architecture',
    question: 'How do large language models work technically, and what are the key architectural innovations?',
    minWordCount: 600,
    requiredTopics: ['transformer', 'attention', 'training', 'parameter', 'neural'],
    description: 'Technical topic requiring depth',
    passThreshold: 3.0,
    delegationThreshold: 2.5,
  },
];

interface EvalResult {
  id: string;
  question: string;
  passed: boolean;
  wordCount: number;
  minWordCount: number;
  topicsFound: string[];
  topicsMissed: string[];
  judgment?: Judgment;
  weightedScore?: number;
  subagentJudgment?: SubagentJudgment;
  subagentScore?: number;
  durationMs: number;
  error?: string;
}

function countDelegations(sessionId: string): number {
  const logPath = join(process.cwd(), 'traces', sessionId, 'run.log');
  if (!existsSync(logPath)) return 0;
  const log = readFileSync(logPath, 'utf-8');
  return (log.match(/Subagent started/g) ?? []).length;
}

async function runEvalCase(evalCase: EvalCase, skipAgent?: string): Promise<EvalResult> {
  const start = Date.now();
  console.log(`\n[EVAL] Running: ${evalCase.id}`);
  console.log(`  Question: ${evalCase.question.slice(0, 80)}...`);

  try {
    let report: string;
    let agentResult: AgentResult | undefined;

    if (skipAgent) {
      report = readFileSync(skipAgent, 'utf-8');
      console.log(`  Using existing report: ${skipAgent}`);
    } else {
      const result = await runAgent(evalCase.question, { returnMetadata: true });
      agentResult = result;
      report = result.report;
    }

    const durationMs = Date.now() - start;
    const wordCount = report.split(/\s+/).filter(Boolean).length;
    const reportLower = report.toLowerCase();

    const topicsFound = evalCase.requiredTopics.filter(t => reportLower.includes(t.toLowerCase()));
    const topicsMissed = evalCase.requiredTopics.filter(t => !reportLower.includes(t.toLowerCase()));

    // Smoke test: basic checks before expensive judge calls
    const smokePass = wordCount >= evalCase.minWordCount && topicsMissed.length === 0;
    if (!smokePass) {
      console.log(`  Smoke test FAILED (words: ${wordCount}/${evalCase.minWordCount}, missing: ${topicsMissed.join(', ')})`);
      return { id: evalCase.id, question: evalCase.question, passed: false, wordCount, minWordCount: evalCase.minWordCount, topicsFound, topicsMissed, durationMs };
    }

    // Quality judge
    console.log(`  Smoke test passed. Running quality judge...`);
    const judgment = await judgeReport(evalCase.question, report);
    const weightedScore = computeWeightedScore(judgment);
    const qualityThreshold = evalCase.passThreshold ?? 3.0;
    const qualityPassed = weightedScore >= qualityThreshold;

    console.log(`  Quality scores:`);
    for (const dim of DIMENSIONS) {
      console.log(`    ${dim}: ${judgment[dim].score}/5`);
    }
    console.log(`  Weighted quality score: ${weightedScore.toFixed(2)} (threshold: ${qualityThreshold})`);

    // Subagent/delegation judge — only when agent actually ran (trace data available)
    let subagentJudgment: SubagentJudgment | undefined;
    let subagentScore: number | undefined;
    let delegationPassed = agentResult === undefined ? true : false;

    if (agentResult) {
      console.log(`  Running delegation judge...`);
      const delegationCount = countDelegations(agentResult.sessionId);
      const subagentInput = {
        question: evalCase.question,
        plan: agentResult.plan,
        report,
        delegationCount,
        steps: agentResult.steps,
        tokens: agentResult.tokens,
        toolCalls: agentResult.toolCalls,
      };

      subagentJudgment = await judgeSubagentStrategy(subagentInput);
      subagentScore = computeSubagentWeightedScore(subagentJudgment);
      const delegationThreshold = evalCase.delegationThreshold ?? 2.5;
      delegationPassed = subagentScore >= delegationThreshold;

      console.log(`  Delegation scores:`);
      for (const dim of SUBAGENT_DIMENSIONS) {
        console.log(`    ${dim}: ${subagentJudgment[dim].score}/5`);
      }
      console.log(`  Weighted delegation score: ${subagentScore.toFixed(2)} (threshold: ${delegationThreshold})`);
    } else {
      console.log(`  Delegation judge skipped (no agent trace available)`);
    }

    // Pass requires quality AND delegation (when delegation is evaluated)
    const passed = qualityPassed && delegationPassed;
    console.log(`  Result: ${passed ? '✓ PASS' : '✗ FAIL'} (quality: ${qualityPassed ? '✓' : '✗'}, delegation: ${agentResult ? (delegationPassed ? '✓' : '✗') : 'n/a'})`);
    console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);

    return { id: evalCase.id, question: evalCase.question, passed, wordCount, minWordCount: evalCase.minWordCount, topicsFound, topicsMissed, judgment, weightedScore, subagentJudgment, subagentScore, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = (err as Error).message;
    console.log(`  Result: ✗ ERROR: ${error}`);
    return {
      id: evalCase.id, question: evalCase.question, passed: false,
      wordCount: 0, minWordCount: evalCase.minWordCount,
      topicsFound: [], topicsMissed: evalCase.requiredTopics,
      durationMs, error,
    };
  }
}

async function main() {
  const resultsDir = join(process.cwd(), 'eval', 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  // Parse CLI args: eval/runner.ts [caseId] [--report path]
  const args = process.argv.slice(2);
  let caseId: string | undefined;
  let reportPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) {
      reportPath = args[++i];
    } else if (!args[i].startsWith('-')) {
      caseId = args[i];
    }
  }

  if (reportPath && !caseId) {
    console.error('--report requires a caseId (e.g. `pnpm eval nuclear-fusion --report ./report.md`)');
    process.exit(1);
  }

  const cases = caseId ? EVAL_CASES.filter(c => c.id === caseId) : EVAL_CASES;

  if (cases.length === 0) {
    console.error(`No eval case found: ${caseId}`);
    console.error(`Available: ${EVAL_CASES.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== Deep Research Agent Evaluation ===`);
  console.log(`Running ${cases.length} case(s)${reportPath ? ' (judge-only mode)' : ''}\n`);

  const results: EvalResult[] = [];
  for (const c of cases) {
    results.push(await runEvalCase(c, reportPath));
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);

  if (results.some(r => r.weightedScore !== undefined)) {
    const scored = results.filter(r => r.weightedScore !== undefined);
    const avgQuality = scored.reduce((sum, r) => sum + r.weightedScore!, 0) / scored.length;
    const avgDelegation = scored.filter(r => r.subagentScore !== undefined).reduce((sum, r) => sum + r.subagentScore!, 0) / scored.filter(r => r.subagentScore !== undefined).length;
    console.log(`Average quality score: ${avgQuality.toFixed(2)}/5.00`);
    console.log(`Average delegation score: ${(avgDelegation || 0).toFixed(2)}/5.00`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(resultsDir, `eval-${timestamp}.json`);
  writeFileSync(outputPath, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  if (passed < results.length) process.exit(1);
}

main().catch(err => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});

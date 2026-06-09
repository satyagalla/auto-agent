import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { runAgent } from '../src/agent/loop.js';

interface EvalCase {
  id: string;
  question: string;
  minWordCount: number;
  requiredTopics: string[];
  description: string;
}

const EVAL_CASES: EvalCase[] = [
  {
    id: 'nuclear-fusion',
    question: 'What is nuclear fusion and what are the current main approaches being pursued?',
    minWordCount: 500,
    requiredTopics: ['plasma', 'tokamak', 'inertial confinement', 'ITER', 'temperature'],
    description: 'Science topic with multiple subtopics',
  },
  {
    id: 'climate-economics',
    question: 'What are the economic costs of climate change according to recent research?',
    minWordCount: 400,
    requiredTopics: ['GDP', 'billion', 'damage', 'cost', 'economic'],
    description: 'Economic research requiring data sources',
  },
  {
    id: 'llm-architecture',
    question: 'How do large language models work technically, and what are the key architectural innovations?',
    minWordCount: 600,
    requiredTopics: ['transformer', 'attention', 'training', 'parameter', 'neural'],
    description: 'Technical topic requiring depth',
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
  durationMs: number;
  error?: string;
}

async function runEvalCase(evalCase: EvalCase): Promise<EvalResult> {
  const start = Date.now();
  console.log(`\n[EVAL] Running: ${evalCase.id}`);
  console.log(`  Question: ${evalCase.question.slice(0, 80)}...`);

  try {
    const report = await runAgent(evalCase.question);
    const durationMs = Date.now() - start;
    const wordCount = report.split(/\s+/).filter(Boolean).length;
    const reportLower = report.toLowerCase();

    const topicsFound = evalCase.requiredTopics.filter(t => reportLower.includes(t.toLowerCase()));
    const topicsMissed = evalCase.requiredTopics.filter(t => !reportLower.includes(t.toLowerCase()));

    const passed = wordCount >= evalCase.minWordCount && topicsMissed.length === 0;

    console.log(`  Result: ${passed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Word count: ${wordCount}/${evalCase.minWordCount}`);
    console.log(`  Topics found: ${topicsFound.length}/${evalCase.requiredTopics.length}`);
    if (topicsMissed.length > 0) console.log(`  Missing: ${topicsMissed.join(', ')}`);
    console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);

    return { id: evalCase.id, question: evalCase.question, passed, wordCount, minWordCount: evalCase.minWordCount, topicsFound, topicsMissed, durationMs };
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

  const caseId = process.argv[2];
  const cases = caseId ? EVAL_CASES.filter(c => c.id === caseId) : EVAL_CASES;

  if (cases.length === 0) {
    console.error(`No eval case found: ${caseId}`);
    console.error(`Available: ${EVAL_CASES.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== Deep Research Agent Evaluation ===`);
  console.log(`Running ${cases.length} case(s)\n`);

  const results: EvalResult[] = [];
  for (const c of cases) {
    results.push(await runEvalCase(c));
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);

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

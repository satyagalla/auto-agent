import { runAgent } from './agent/loop.js';

const question = process.argv.slice(2).join(' ');

if (!question) {
  console.error('Usage: pnpm dev "your research question"');
  process.exit(1);
}

console.log(`\nResearching: ${question}\n`);

const report = await runAgent(question);

console.log('\n--- RESEARCH REPORT ---\n');
console.log(report);

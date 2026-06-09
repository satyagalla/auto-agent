import { registry } from './registry.js';
import { webTools } from './web.js';
import { sourceTools } from './source.js';
import { extractTools } from './extract.js';
import { dataTools } from './data.js';
import { codeTools } from './code.js';
import { datasourceTools } from './datasource.js';
import { verifyTools } from './verify.js';
import { planningTools } from './planning.js';
import { knowledgeTools } from './knowledge.js';
import { sessionTools } from './session.js';
import { outputTools } from './output.js';
import { agentTools } from './agent-tools.js';

export function registerAllTools(): void {
  const all = [
    ...webTools,
    ...sourceTools,
    ...extractTools,
    ...dataTools,
    ...codeTools,
    ...datasourceTools,
    ...verifyTools,
    ...planningTools,
    ...knowledgeTools,
    ...sessionTools,
    ...outputTools,
    ...agentTools,
  ];
  for (const tool of all) {
    registry.register(tool);
  }
}

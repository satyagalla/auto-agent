import pino from 'pino';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino(
  { level },
  process.env.NODE_ENV === 'production'
    ? process.stdout
    : pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } })
);

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export function createSessionLogger(sessionId: string, context: Record<string, unknown>) {
  const traceDir = join(process.cwd(), 'traces', sessionId);
  if (!existsSync(traceDir)) mkdirSync(traceDir, { recursive: true });

  const logPath = join(traceDir, 'run.log');

  const sessionLogger = pino(
    { level },
    pino.transport({
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, ignore: 'pid,hostname' },
          level,
        },
        {
          target: 'pino-pretty',
          options: { colorize: false, ignore: 'pid,hostname', destination: logPath, append: true },
          level,
        },
      ],
    })
  );

  return sessionLogger.child(context);
}

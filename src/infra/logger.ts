import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino(
  { level },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } })
    : process.stdout
);

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

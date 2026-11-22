import pino, { type Logger } from 'pino';

export type AppLogger = Logger;

export function createLogger(level: string): AppLogger {
  return pino({ level, base: { service: 'scan' } });
}

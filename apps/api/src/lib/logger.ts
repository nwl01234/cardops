import pino, { type Logger } from 'pino';
import type { AppConfig } from '../config/env';

export type AppLogger = Logger;

export function createLogger(config: AppConfig): AppLogger {
  const pretty = !config.isProduction && !config.isTest;

  return pino({
    level: config.isTest ? 'silent' : config.LOG_LEVEL,
    base: { service: 'cardops-api', version: config.APP_VERSION },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        'passwordHash',
      ],
      censor: '[redacted]',
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:mm:ss.l',
            ignore: 'pid,hostname,service,version',
            singleLine: true,
          },
        }
      : undefined,
  });
}

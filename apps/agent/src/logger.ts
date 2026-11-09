import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Safety net: if a token ever ends up in a log object, it's replaced.
    redact: { paths: ['token', '*.token', '*.*.token'], censor: '[redacted]' },
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' /* SYS: = local time, not UTC */, ignore: 'pid,hostname' },
    },
  });
}

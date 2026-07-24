/**
 * Logger utility for the application
 */
import 'dotenv/config';
import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const ENVIRONMENT = process.env.NODE_ENV ?? 'development';
const LOG_SERVER_API_KEY = process.env.LOG_SERVER_API_KEY;
const BETTERSTACK_INGESTING_URL = process.env.BETTERSTACK_INGESTING_URL;

const hasBetterStack = LOG_SERVER_API_KEY && BETTERSTACK_INGESTING_URL;

const redactPaths = [
  'authorization',
  'headers.authorization',
  'cookie',
  'headers.cookie',
  'token',
  'apiKey',
  'sourceToken',
  'password',
  'jwt',
  'embedding',
  'vector',
  'content',
  'prompt',
  'chatHistory',
  'memoryContext',
];

let loggerInstance: pino.Logger | null = null;

export const createLogger = () => {
  try {
    const transports: pino.TransportTargetOptions[] = [
      {
        target: 'pino/file',
        level: LOG_LEVEL,
        options: { destination: 1 },
      }, // stdout
    ];

    if (hasBetterStack) {
      transports.push({
        target: '@logtail/pino',
        options: {
          sourceToken: LOG_SERVER_API_KEY!,
          options: {
            endpoint: BETTERSTACK_INGESTING_URL!,
          },
        },
      });
    }

    const logger = pino({
      level: LOG_LEVEL,
      base: {
        service: 'decommerce-bot',
        environment: ENVIRONMENT,
      },
      redact: {
        paths: redactPaths,
        censor: '[REDACTED]',
      },
      transport: transports.length > 1 ? { targets: transports } : undefined,
    });

    loggerInstance = logger;

    // if fallback, log a startup warning once
    if (!hasBetterStack) {
      logger.info(
        {
          event: 'logger.startup.fallback',
        },
        'Better Stack logging not configured - using stdout only',
      );
    }
  } catch (error) {
    // fallback to basic console if construction fails
    console.error('[Logger] Failed to construct Pino logger, falling back to console:', error);
    const basicLogger = {
      debug: (data: any, msg: string) => console.debug(data, msg),
      info: (data: any, msg: string) => console.info(data, msg),
      warn: (data: any, msg: string) => console.warn(data, msg),
      error: (data: any, msg: string) => console.error(data, msg),
      fatal: (data: any, msg: string) => console.error(data, msg),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    } as any;
    loggerInstance = basicLogger;
  }
};

createLogger();

export const logger = loggerInstance!;

export function flushLogger() {
  if (loggerInstance) {
    return (loggerInstance as any).flush();
  }
  return Promise.resolve();
}

export function closeLogger() {
  if (loggerInstance && typeof (loggerInstance as any).close === 'function') {
    return (loggerInstance as any).close();
  }
  return Promise.resolve();
}

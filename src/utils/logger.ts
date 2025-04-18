/**
 * Logger utility for the application
 */
import { config } from 'dotenv';

config();

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogContext = {
  userId?: string;
  guildId?: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type LogDestination = 'console' | 'betterstack' | 'discord' | 'online' | 'local';

export type LogOptions = {
  level: LogLevel;
  destinations?: LogDestination[];
  context?: LogContext;
};

export class Logger {
  // Singleton instance
  private static instance: Logger;

  // Get the singleton logger instance
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Main log method
   * @param message Message to log
   * @param options Log options including level, destinations, and context
   */
  public async log(message: string, options: LogOptions): Promise<void> {
    const { level, destinations = ['online'], context } = options;
    const timestamp = new Date().toISOString();
    const promises: Promise<void>[] = [];

    // Log to each requested destination
    for (const destination of destinations) {
      if (destination === 'online') {
        promises.push(this.logToDiscord(level, message, context));
        promises.push(this.logToBetterStack(level, message, context));
      } else if (destination === 'local') {
        this.logToConsole(level, message, timestamp, context);
      } else if (destination === 'console') {
        this.logToConsole(level, message, timestamp, context);
      } else if (destination === 'betterstack') {
        promises.push(this.logToBetterStack(level, message, context));
      } else if (destination === 'discord') {
        promises.push(this.logToDiscord(level, message, context));
      }
    }

    // Wait for all async logging to complete
    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (error) {
        console.error('[Logger] Error logging to destinations:', error);
      }
    }
  }

  /**
   * Helper method for info logs
   */
  public info(message: string, options?: Partial<LogOptions>): Promise<void> {
    return this.log(message, { level: 'info', ...options });
  }

  /**
   * Helper method for warning logs
   */
  public warn(message: string, options?: Partial<LogOptions>): Promise<void> {
    return this.log(message, { level: 'warn', ...options });
  }

  /**
   * Helper method for error logs
   */
  public error(message: string, error?: Error, options?: Partial<LogOptions>): Promise<void> {
    const context = error
      ? {
          ...(options?.context || {}),
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : options?.context;

    return this.log(message, {
      level: 'error',
      ...options,
      context,
    });
  }

  /**
   * Helper method for debug logs
   */
  public debug(message: string, options?: Partial<LogOptions>): Promise<void> {
    return this.log(message, { level: 'debug', ...options });
  }

  /**
   * Log to console/terminal
   */
  private logToConsole(
    level: LogLevel,
    message: string,
    timestamp: string,
    context?: LogContext,
  ): void {
    const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;

    switch (level) {
      case 'info':
      case 'debug':
        console.log(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'error':
        console.error(logMessage);
        break;
    }
  }

  /**
   * Log to BetterStack
   */
  private async logToBetterStack(
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): Promise<void> {
    const token = process.env.BETTERSTACK_TOKEN;
    const endpoint = process.env.BETTERSTACK_ENDPOINT;

    if (!token || !endpoint) {
      console.error(
        '[Logger] BetterStack logging missing token or endpoint in environment variables',
      );
      return;
    }

    try {
      const payload = {
        dt: new Date()
          .toISOString()
          .replace('T', ' ')
          .replace(/\.\d+Z$/, ' UTC'),
        level,
        message,
        ...(context && { data: context }),
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `[Logger] Failed to log to BetterStack (${level}): ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      console.error(`[Logger] Error sending log to BetterStack (${level}):`, error);
    }
  }

  /**
   * Log to Discord webhook
   */
  private async logToDiscord(
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): Promise<void> {
    const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL;

    if (!webhookUrl) {
      console.error('[Logger] Discord logging missing webhook URL in environment variables');
      return;
    }

    try {
      // Format the message for Discord
      const timestamp = new Date().toISOString();
      const contextStr = context
        ? `\n**Context:**\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``
        : '';

      // Set color based on log level
      let color = 0x007bff; // Blue for info/debug
      if (level === 'warn') color = 0xffc107; // Yellow for warnings
      if (level === 'error') color = 0xdc3545; // Red for errors

      const payload = {
        embeds: [
          {
            title: `${level.toUpperCase()} Log`,
            description: message + contextStr,
            color,
            timestamp,
            footer: {
              text: 'DSOP Bot Logger',
            },
          },
        ],
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `[Logger] Failed to log to Discord (${level}): ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      console.error(`[Logger] Error sending log to Discord (${level}):`, error);
    }
  }
}

// Export a default logger instance for convenience
export const logger = Logger.getInstance();

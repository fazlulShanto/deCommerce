import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { rawBotCommands, type SlashCommand } from '../config/command-handler';
import { redis } from '../utils/redis';

after(() => {
  redis.disconnect();
});

test('every registered command has serializable command data', () => {
  const invalidCommands = (rawBotCommands as unknown[]).flatMap((entry, index) => {
    const command = entry as Partial<SlashCommand> & {
      command?: { name?: string };
    };

    if (command.data && typeof command.data.toJSON === 'function') {
      return [];
    }

    return [
      {
        index,
        name: command.name ?? command.command?.name ?? 'unknown',
      },
    ];
  });

  assert.deepEqual(invalidCommands, []);
  assert.doesNotThrow(() => {
    (rawBotCommands as SlashCommand[]).map((command) => command.data.toJSON());
  });
});

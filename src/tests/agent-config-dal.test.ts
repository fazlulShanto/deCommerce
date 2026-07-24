import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentConfigModel, getOrCreateAgentConfig } from '../db/aiAgentConfig.dal';

test('get-or-create persists memory defaults on a legacy config', async (t) => {
  const legacyConfig: Record<string, unknown> = {
    guildId: 'legacy-guild',
  };

  t.mock.method(
    AgentConfigModel as any,
    'findOneAndUpdate',
    async (_filter: unknown, update: any) => {
      if (!Array.isArray(update)) {
        return legacyConfig;
      }

      const normalizedConfig = { ...legacyConfig };
      for (const [field, expression] of Object.entries(update[0].$set)) {
        const fallback = (expression as { $ifNull: [string, unknown] }).$ifNull[1];
        normalizedConfig[field] ??= fallback;
      }
      return normalizedConfig;
    },
  );

  const config = await getOrCreateAgentConfig('legacy-guild');

  assert.equal(config.memoryEnabled, false);
  assert.equal(config.memoryState, 'disabled');
  assert.equal(config.initialBackfillVersion, 0);
  assert.equal(config.memoryGeneration, 1);
});

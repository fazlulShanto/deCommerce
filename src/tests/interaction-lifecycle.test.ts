import assert from 'node:assert/strict';
import { test } from 'node:test';
import handleInteractionCreate from '../events/interaction-create';
import { redis } from '../utils/redis';
import { handleEnableMemory } from '../commands/admin/enable-memory';

test('an expired interaction during permission checks never rejects the gateway handler', async (t) => {
  t.mock.method(redis, 'get', async () =>
    JSON.stringify({ botAdminRoleId: 'admin-role', currency: 'USD' }),
  );

  const unknownInteraction = Object.assign(new Error('Unknown interaction'), { code: 10062 });
  let commandExecuted = false;
  let fallbackReplyAttempted = false;
  let deferAttempted = false;
  const interaction = {
    guildId: 'guild',
    member: { roles: [] },
    commandName: 'enable-memory',
    client: {
      commands: new Map([
        [
          'enable-memory',
          {
            requiredPermissions: ['BotAdmin'],
            deferBeforePermissionChecks: true,
            execute: async () => {
              commandExecuted = true;
            },
          },
        ],
      ]),
      isPremiumOrTrial: async () => true,
      isBotAdmin: async () => {
        if (!interaction.deferred) throw unknownInteraction;
        return false;
      },
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    deferReply: async () => {
      deferAttempted = true;
      interaction.deferred = true;
    },
    reply: async () => {
      fallbackReplyAttempted = true;
      throw unknownInteraction;
    },
    followUp: async () => {
      throw unknownInteraction;
    },
  };

  await assert.doesNotReject(() => handleInteractionCreate(interaction as never));
  assert.equal(commandExecuted, false);
  assert.equal(fallbackReplyAttempted, false);
  assert.equal(deferAttempted, true);
});

test('an expired initial acknowledgement is not followed by another reply', async (t) => {
  t.mock.method(redis, 'get', async () => null);

  const unknownInteraction = Object.assign(new Error('Unknown interaction'), { code: 10062 });
  let fallbackReplyAttempted = false;
  const interaction = {
    guildId: 'guild',
    member: { roles: [] },
    commandName: 'enable-memory',
    client: {
      commands: new Map([
        [
          'enable-memory',
          {
            requiredPermissions: ['BotAdmin'],
            deferBeforePermissionChecks: true,
            execute: async () => undefined,
          },
        ],
      ]),
      isPremiumOrTrial: async () => true,
      isBotAdmin: async () => true,
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    deferReply: async () => {
      throw unknownInteraction;
    },
    reply: async () => {
      fallbackReplyAttempted = true;
      throw unknownInteraction;
    },
    followUp: async () => {
      fallbackReplyAttempted = true;
      throw unknownInteraction;
    },
    editReply: async () => {
      fallbackReplyAttempted = true;
      throw unknownInteraction;
    },
  };

  await assert.doesNotReject(() => handleInteractionCreate(interaction as never));
  assert.equal(fallbackReplyAttempted, false);
});

test('enable-memory reuses the acknowledgement created before permission checks', async (t) => {
  const originalFeatureFlag = process.env.MEMORY_FEATURE_ENABLED;
  process.env.MEMORY_FEATURE_ENABLED = 'false';
  t.after(() => {
    if (originalFeatureFlag === undefined) {
      delete process.env.MEMORY_FEATURE_ENABLED;
    } else {
      process.env.MEMORY_FEATURE_ENABLED = originalFeatureFlag;
    }
  });

  let deferAttempted = false;
  let response = '';
  await handleEnableMemory({
    deferred: true,
    replied: false,
    guildId: 'guild',
    deferReply: async () => {
      deferAttempted = true;
    },
    editReply: async (value: string) => {
      response = value;
    },
  } as never);

  assert.equal(deferAttempted, false);
  assert.equal(response, 'Memory is disabled by deployment configuration.');
});

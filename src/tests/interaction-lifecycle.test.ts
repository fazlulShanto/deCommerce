import assert from 'node:assert/strict';
import { test } from 'node:test';
import handleInteractionCreate from '../events/interaction-create';
import { redis } from '../utils/redis';
import { handleEnableMemory } from '../commands/admin/enable-memory';
import ChatCommand from '../commands/ai/chat';
import { AgentConfigModel } from '../db/aiAgentConfig.dal';

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

test('duplicate command delivery is claimed before a second Discord acknowledgement', async (t) => {
  t.mock.method(redis, 'get', async () => null);

  const alreadyAcknowledged = Object.assign(new Error('Interaction has already been acknowledged'), {
    code: 40060,
  });
  let discordAcknowledgements = 0;
  let commandExecutions = 0;
  const command = {
    requiredPermissions: [],
    deferBeforePermissionChecks: true,
    execute: async () => {
      commandExecutions += 1;
    },
  };

  const createInteraction = () => {
    const interaction = {
      id: 'same-interaction',
      guildId: 'guild',
      member: { roles: [] },
      commandName: 'chat',
      client: {
        commands: new Map([['chat', command]]),
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
        discordAcknowledgements += 1;
        if (discordAcknowledgements > 1) throw alreadyAcknowledged;
        interaction.deferred = true;
      },
      reply: async () => {
        throw alreadyAcknowledged;
      },
      followUp: async () => {
        throw alreadyAcknowledged;
      },
      editReply: async () => {
        throw alreadyAcknowledged;
      },
    };
    return interaction;
  };

  await handleInteractionCreate(createInteraction() as never);
  await handleInteractionCreate(createInteraction() as never);

  assert.equal(discordAcknowledgements, 1);
  assert.equal(commandExecutions, 1);
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

test('chat reuses an acknowledgement that already exists', async (t) => {
  const originalFeatureFlag = process.env.MEMORY_FEATURE_ENABLED;
  process.env.MEMORY_FEATURE_ENABLED = 'false';
  t.after(() => {
    if (originalFeatureFlag === undefined) {
      delete process.env.MEMORY_FEATURE_ENABLED;
    } else {
      process.env.MEMORY_FEATURE_ENABLED = originalFeatureFlag;
    }
  });

  const commandFailure = new Error('stop after acknowledgement check');
  const config = {
    guildId: 'guild',
    memoryEnabled: false,
    memoryGeneration: 1,
    retrieverScoreThreshold: 0.5,
    retrieverTopK: 4,
    temperature: 0.7,
    get systemPrompt() {
      throw commandFailure;
    },
  };
  t.mock.method(AgentConfigModel, 'findOneAndUpdate', async () => config as never);

  const alreadyAcknowledged = Object.assign(
    new Error('Interaction has already been acknowledged'),
    {
      code: 40060,
    },
  );
  let deferAttempts = 0;
  let errorReply = '';
  const interaction = {
    guildId: 'guild',
    guild: {
      id: 'guild',
      name: 'Guild',
      description: null,
      members: {
        fetch: async () => {
          throw new Error('member unavailable');
        },
      },
      fetchOwner: async () => {
        throw new Error('owner unavailable');
      },
    },
    member: {},
    user: {
      id: 'user',
      username: 'user',
      globalName: null,
    },
    channelId: 'channel',
    channel: {
      messages: {
        fetch: async () => new Map(),
      },
    },
    options: {
      getString: () => 'hello',
    },
    deferred: true,
    replied: false,
    deferReply: async () => {
      deferAttempts += 1;
      throw alreadyAcknowledged;
    },
    editReply: async (response: string) => {
      errorReply = response;
    },
    followUp: async () => undefined,
    reply: async () => undefined,
  };

  await assert.doesNotReject(() => ChatCommand.execute(interaction as never));
  assert.equal(deferAttempts, 0);
  assert.match(errorReply, /Something went wrong/);
});

test('chat yields when another process wins the acknowledgement race', async (t) => {
  const originalFeatureFlag = process.env.MEMORY_FEATURE_ENABLED;
  process.env.MEMORY_FEATURE_ENABLED = 'false';
  t.after(() => {
    if (originalFeatureFlag === undefined) {
      delete process.env.MEMORY_FEATURE_ENABLED;
    } else {
      process.env.MEMORY_FEATURE_ENABLED = originalFeatureFlag;
    }
  });

  const alreadyAcknowledged = Object.assign(
    new Error('Interaction has already been acknowledged'),
    {
      code: 40060,
    },
  );
  let deferAttempts = 0;
  let responseAttempts = 0;
  const interaction = {
    guildId: 'guild',
    guild: { id: 'guild' },
    options: {
      getString: () => 'hello',
    },
    deferred: false,
    replied: false,
    deferReply: async () => {
      deferAttempts += 1;
      throw alreadyAcknowledged;
    },
    editReply: async () => {
      responseAttempts += 1;
    },
    followUp: async () => {
      responseAttempts += 1;
    },
    reply: async () => {
      responseAttempts += 1;
    },
  };

  await assert.doesNotReject(() => ChatCommand.execute(interaction as never));
  assert.equal(deferAttempts, 1);
  assert.equal(responseAttempts, 0);
});

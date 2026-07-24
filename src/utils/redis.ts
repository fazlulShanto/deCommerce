import { StoreConfigDAL } from '@/db/storeConfig.dal';
import { logger } from '@/utils/logger';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, { lazyConnect: true });

redis.on('error', (err) => {
  logger.error(
    {
      event: 'redis.connection.error',
      errorCode:
        'code' in err && typeof err.code === 'string' ? err.code : 'redis_connection_error',
      errorName: err.name,
    },
    'Redis connection error',
  );
});

redis.on('connect', () => {
  logger.info({ event: 'redis.connected' }, 'Redis connected');
});

const storeConfigKey = 'storeConfigs:';

export type StoreConfig = {
  botAdminRoleId: string;
  currency: string;
};

const connectToRedis = async () => {
  if (redis.status === 'wait') {
    await redis.connect();
  }
};

const loadStoreConfigsIntoCache = async () => {
  const configs = await StoreConfigDAL.getAllConfigs();
  const formattedConfigs: { key: string; value: StoreConfig }[] = configs.map((config) => ({
    key: config.guildId,
    value: {
      botAdminRoleId: config.botAdminRoleId,
      currency: config.currency,
    },
  }));

  for (const config of formattedConfigs) {
    await redis.set(`${storeConfigKey}${config.key}`, JSON.stringify(config.value));
  }
  logger.info(
    { event: 'redis.store_configs.loaded', configCount: formattedConfigs.length },
    'Store configs loaded into cache',
  );
};

const getStoreConfigFromCache = async (guildId: string) => {
  const config = await redis.get(`${storeConfigKey}${guildId}`);
  if (!config) {
    return {
      botAdminRoleId: '',
      currency: '',
    };
  }
  try {
    const parsedConfig = JSON.parse(config) as StoreConfig;
    return parsedConfig;
  } catch {
    return {
      botAdminRoleId: '',
      currency: '',
    };
  }
};

const setStoreConfigInCache = async (guildId: string, config: StoreConfig) => {
  await redis.set(`${storeConfigKey}${guildId}`, JSON.stringify(config));
  logger.info({ event: 'redis.store_config.updated', guildId }, 'Store config cache updated');
};

export {
  redis,
  connectToRedis,
  loadStoreConfigsIntoCache,
  getStoreConfigFromCache,
  setStoreConfigInCache,
};

import { StoreConfigDAL } from '@/db/storeConfig.dal';
import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || '';

const redis = new Redis(redisUrl);

redis.on('error', (err) => {
  console.error('Redis error', err);
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

const storeConfigKey = 'storeConfigs:';

export type StoreConfig = {
  botAdminRoleId: string;
  currency: string;
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
  console.log('✅ Store configs loaded into cache');
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
  console.log('Setting store config in cache', guildId, config);
  const result = await redis.set(`${storeConfigKey}${guildId}`, JSON.stringify(config));
  console.log('Result', result);
};

export { redis, loadStoreConfigsIntoCache, getStoreConfigFromCache, setStoreConfigInCache };

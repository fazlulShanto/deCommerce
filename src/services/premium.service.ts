import type { PremiumInfoDocument } from '@/db/premium-info.dal';
import { redis } from '@/utils/redis';
import { PremiumInfoDAL, PremiumInfoModel } from '@/db/premium-info.dal';
import type mongoose from 'mongoose';

const CACHE_TTL = 3600; // 1 hour in seconds

type PremiumInfo = Omit<PremiumInfoDocument, keyof mongoose.Document>;

// Cache premium status
async function cachePremiumInfo(
  guildId: string,
  premiumInfo: PremiumInfo,
  customTTL?: number,
): Promise<void> {
  const key = `premium:${guildId}`;
  await redis.setex(
    key,
    customTTL || CACHE_TTL,
    JSON.stringify({
      isPremium: premiumInfo.isPremium,
      isTrial: premiumInfo.isTrial,
      premiumExpiryDate: premiumInfo.premiumExpiryDate?.toISOString(),
      trialEndDate: premiumInfo.trialEndDate?.toISOString(),
    }),
  );
}

// Check access with cache
export const hasAccessWithCache = async (guildId: string): Promise<boolean> => {
  // Try cache first
  const cachedInfo = await redis.get(`premium:${guildId}`);

  if (cachedInfo) {
    const info = JSON.parse(cachedInfo) as PremiumInfo;
    const now = new Date();

    // Check premium status
    if (info.isPremium && info.premiumExpiryDate) {
      if (new Date(info.premiumExpiryDate) > now) return true;
    }

    // Check trial status
    if (info.isTrial && info.trialEndDate) {
      if (new Date(info.trialEndDate) > now) return true;
    }

    return false;
  }

  // Cache miss - get from database and cache result
  const premiumInfo = await PremiumInfoDAL.getPremiumInfoByGuildId(guildId);
  if (!premiumInfo) return false;

  await cachePremiumInfo(guildId, premiumInfo);
  return PremiumInfoDAL.hasAccess(guildId);
};

// Invalidate cache when premium status changes
export const invalidatePremiumCache = async (guildId: string): Promise<void> => {
  await redis.del(`premium:${guildId}`);
};

// Run every hour
export const updatePremiumStatusCache = async () => {
  // Get all servers with active premium/trials that are about to expire
  const now = new Date();
  const buffer = 1000 * 60 * 3; // 3 minutes buffer

  const expiringAccounts = await PremiumInfoModel.find({
    $or: [
      { isPremium: true, premiumExpiryDate: { $lt: new Date(now.getTime() + buffer), $gt: now } },
      { isTrial: true, trialEndDate: { $lt: new Date(now.getTime() + buffer), $gt: now } },
    ],
  });

  // Update cache for each expiring account
  for (const account of expiringAccounts) {
    // Calculate time until expiration in seconds
    let timeUntilExpiration: number;

    if (account.isPremium && account.premiumExpiryDate) {
      timeUntilExpiration = Math.max(
        0,
        Math.floor((account.premiumExpiryDate.getTime() - now.getTime()) / 1000),
      );
    } else if (account.isTrial && account.trialEndDate) {
      timeUntilExpiration = Math.max(
        0,
        Math.floor((account.trialEndDate.getTime() - now.getTime()) / 1000),
      );
    } else {
      timeUntilExpiration = buffer; // default if no expiration date found
    }

    // Add a small buffer (3 minutes) for safety
    const safetyBuffer = 180; // 3 minutes in seconds
    const customTTL = timeUntilExpiration + safetyBuffer;

    await cachePremiumInfo(account.guildId, account, customTTL);
  }

  // For accounts that just expired, invalidate cache
  const justExpired = await PremiumInfoModel.find({
    $or: [
      { isPremium: true, premiumExpiryDate: { $lt: now, $gt: new Date(now.getTime() - buffer) } },
      { isTrial: true, trialEndDate: { $lt: now, $gt: new Date(now.getTime() - buffer) } },
    ],
  });

  for (const account of justExpired) {
    await invalidatePremiumCache(account.guildId);
  }
  console.log('✅ Premium status cache updated!');
};

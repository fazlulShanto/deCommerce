import mongoose, { type InferSchemaType } from 'mongoose';

export const BACKFILL_VERSION = 1;

const runStatuses = [
  'queued',
  'running',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
] as const;

const channelStatuses = ['pending', 'running', 'completed', 'skipped', 'failed'] as const;

const runSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: BACKFILL_VERSION },
    generation: { type: Number, required: true, default: 1 },
    jobId: { type: String, required: true },
    status: { type: String, enum: runStatuses, default: 'queued' },
    enabledAt: { type: Date, required: true },
    cutoffAt: { type: Date, required: true },
    maxScannedMessagesPerChannel: { type: Number, required: true },
    discoveredChannelCount: { type: Number, default: 0 },
    completedChannelCount: { type: Number, default: 0 },
    skippedChannelCount: { type: Number, default: 0 },
    failedChannelCount: { type: Number, default: 0 },
    scannedCount: { type: Number, default: 0 },
    eligibleMessageCount: { type: Number, default: 0 },
    indexedChunkCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
  },
  { timestamps: true },
);

runSchema.index({ guildId: 1, generation: 1, version: 1 }, { unique: true });

const channelCheckpointSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: BACKFILL_VERSION },
    generation: { type: Number, required: true, default: 1 },
    channelId: { type: String, required: true, index: true },
    channelType: {
      type: String,
      enum: ['text', 'announcement'],
      required: true,
    },
    status: { type: String, enum: channelStatuses, default: 'pending' },
    beforeMessageId: { type: String, default: null },
    scannedCount: { type: Number, default: 0 },
    eligibleMessageCount: { type: Number, default: 0 },
    indexedChunkCount: { type: Number, default: 0 },
    skippedMessageCount: { type: Number, default: 0 },
    lastProcessedMessageId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
  },
  { timestamps: true },
);

channelCheckpointSchema.index(
  { guildId: 1, generation: 1, version: 1, channelId: 1 },
  { unique: true },
);

export const MemoryBackfillRunModel =
  mongoose.models.MemoryBackfillRun ?? mongoose.model('MemoryBackfillRun', runSchema);
export const MemoryBackfillChannelCheckpointModel =
  mongoose.models.MemoryBackfillChannelCheckpoint ??
  mongoose.model('MemoryBackfillChannelCheckpoint', channelCheckpointSchema);

export type MemoryBackfillRun = InferSchemaType<typeof runSchema> & {
  _id: mongoose.Types.ObjectId;
};
export type MemoryBackfillChannelCheckpoint = InferSchemaType<typeof channelCheckpointSchema> & {
  _id: mongoose.Types.ObjectId;
};
export type MemoryBackfillRunStatus = (typeof runStatuses)[number];
export type MemoryBackfillChannelStatus = (typeof channelStatuses)[number];
type NullableMemoryBackfillRunField =
  | 'startedAt'
  | 'completedAt'
  | 'lastHeartbeatAt'
  | 'lastErrorCode';
export type MemoryBackfillRunUpdate = Omit<
  Partial<MemoryBackfillRun>,
  NullableMemoryBackfillRunField
> & {
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  lastErrorCode?: string | null;
};

export interface BackfillRunKey {
  guildId: string;
  generation: number;
  version: number;
}

export interface CreateBackfillRunInput extends BackfillRunKey {
  jobId: string;
  enabledAt: Date;
  cutoffAt: Date;
  maxScannedMessagesPerChannel: number;
}

export async function getOrCreateRun(input: CreateBackfillRunInput): Promise<MemoryBackfillRun> {
  const run = await MemoryBackfillRunModel.findOneAndUpdate(
    {
      guildId: input.guildId,
      generation: input.generation,
      version: input.version,
    },
    {
      $setOnInsert: {
        ...input,
        status: 'queued',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return run as unknown as MemoryBackfillRun;
}

export async function findRun(
  guildId: string,
  generation = 1,
  version = BACKFILL_VERSION,
): Promise<MemoryBackfillRun | null> {
  return MemoryBackfillRunModel.findOne({
    guildId,
    generation,
    version,
  }) as unknown as Promise<MemoryBackfillRun | null>;
}

export async function updateRun(
  key: BackfillRunKey,
  updates: MemoryBackfillRunUpdate,
): Promise<void> {
  await MemoryBackfillRunModel.updateOne(key, { $set: updates });
}

export async function markRunRunning(key: BackfillRunKey, now: Date): Promise<void> {
  await MemoryBackfillRunModel.updateOne(key, {
    $set: {
      status: 'running',
      lastHeartbeatAt: now,
      lastErrorCode: null,
    },
    $setOnInsert: { startedAt: now },
  });
  await MemoryBackfillRunModel.updateOne({ ...key, startedAt: null }, { $set: { startedAt: now } });
}

export async function markRunFinished(
  key: BackfillRunKey,
  status: Extract<
    MemoryBackfillRunStatus,
    'completed' | 'completed_with_warnings' | 'failed' | 'cancelled'
  >,
  errorCode: string | null,
  now: Date,
): Promise<void> {
  await MemoryBackfillRunModel.updateOne(key, {
    $set: {
      status,
      completedAt: now,
      lastHeartbeatAt: now,
      lastErrorCode: errorCode,
    },
  });
}

export async function upsertChannelCheckpoint(
  key: BackfillRunKey,
  channelId: string,
  channelType: 'text' | 'announcement',
): Promise<MemoryBackfillChannelCheckpoint> {
  const checkpoint = await MemoryBackfillChannelCheckpointModel.findOneAndUpdate(
    { ...key, channelId },
    {
      $setOnInsert: {
        ...key,
        channelId,
        channelType,
        status: 'pending',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return checkpoint as unknown as MemoryBackfillChannelCheckpoint;
}

export async function findChannelCheckpoint(
  key: BackfillRunKey,
  channelId: string,
): Promise<MemoryBackfillChannelCheckpoint | null> {
  return MemoryBackfillChannelCheckpointModel.findOne({
    ...key,
    channelId,
  }) as unknown as Promise<MemoryBackfillChannelCheckpoint | null>;
}

export async function claimChannelCheckpoint(
  key: BackfillRunKey,
  channelId: string,
  now: Date,
): Promise<MemoryBackfillChannelCheckpoint | null> {
  const checkpoint = await MemoryBackfillChannelCheckpointModel.findOneAndUpdate(
    {
      ...key,
      channelId,
      status: { $in: ['pending', 'running', 'failed'] },
    },
    {
      $set: {
        status: 'running',
        startedAt: now,
        completedAt: null,
        lastErrorCode: null,
      },
    },
    { new: true },
  );
  return checkpoint as unknown as MemoryBackfillChannelCheckpoint | null;
}

export async function advanceChannelCheckpoint(
  key: BackfillRunKey,
  channelId: string,
  updates: {
    beforeMessageId: string | null;
    lastProcessedMessageId: string | null;
    scannedCount: number;
    eligibleMessageCount: number;
    indexedChunkCount: number;
    skippedMessageCount: number;
  },
): Promise<void> {
  await MemoryBackfillChannelCheckpointModel.updateOne(
    { ...key, channelId, status: 'running' },
    { $set: updates },
  );
}

export async function markChannelFinished(
  key: BackfillRunKey,
  channelId: string,
  status: Extract<MemoryBackfillChannelStatus, 'completed' | 'skipped' | 'failed'>,
  errorCode: string | null,
  now: Date,
): Promise<void> {
  await MemoryBackfillChannelCheckpointModel.updateOne(
    { ...key, channelId },
    {
      $set: {
        status,
        completedAt: now,
        lastErrorCode: errorCode,
      },
    },
  );
}

export interface BackfillSummary {
  discoveredChannelCount: number;
  completedChannelCount: number;
  skippedChannelCount: number;
  failedChannelCount: number;
  scannedCount: number;
  eligibleMessageCount: number;
  indexedChunkCount: number;
}

export async function recomputeRunSummary(key: BackfillRunKey): Promise<BackfillSummary> {
  const checkpoints = (await MemoryBackfillChannelCheckpointModel.find(key).lean()) as unknown as
    | MemoryBackfillChannelCheckpoint[]
    | null;
  const rows = checkpoints ?? [];
  const summary: BackfillSummary = {
    discoveredChannelCount: rows.length,
    completedChannelCount: 0,
    skippedChannelCount: 0,
    failedChannelCount: 0,
    scannedCount: 0,
    eligibleMessageCount: 0,
    indexedChunkCount: 0,
  };

  for (const checkpoint of rows) {
    if (checkpoint.status === 'completed') summary.completedChannelCount += 1;
    if (checkpoint.status === 'skipped') summary.skippedChannelCount += 1;
    if (checkpoint.status === 'failed') summary.failedChannelCount += 1;
    summary.scannedCount += checkpoint.scannedCount;
    summary.eligibleMessageCount += checkpoint.eligibleMessageCount;
    summary.indexedChunkCount += checkpoint.indexedChunkCount;
  }

  await updateRun(key, summary);
  return summary;
}

export async function deleteBackfillGeneration(guildId: string, generation: number): Promise<void> {
  await Promise.all([
    MemoryBackfillRunModel.deleteMany({ guildId, generation }),
    MemoryBackfillChannelCheckpointModel.deleteMany({
      guildId,
      generation,
    }),
  ]);
}

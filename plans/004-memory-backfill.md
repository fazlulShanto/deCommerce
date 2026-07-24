# Plan 004: Implement `/enable-memory` and resumable BullMQ historical backfill

> **Executor instructions:** Plan 003 must be complete. Implement the command,
> queue, worker, checkpoints, status, and deployment gate exactly as scoped.
> Do not expose the feature in production until Plan 005's live listeners are
> deployed. Run every verification; stop on a STOP condition. Update
> `plans/README.md` when complete.
>
> **Drift check (run first):**
>
> ```sh
> git diff --stat 327f0f1..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/index.ts src/commands/index.ts src/config src/db src/services src/utils/redis.ts
> git diff --stat -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/index.ts src/commands/index.ts src/config src/db src/services src/utils/redis.ts
> ```

## Status

- **Priority:** P1
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** `plans/003-memory-foundation.md`
- **Category:** feature / reliability / performance
- **Planned at:** commit `327f0f1`, 2026-07-24

## Why this matters

Enabling memory on an old server can require hundreds of Discord REST pages and
millions of external embedding/vector operations. The slash command must return
quickly, a process restart must not restart every channel from zero, and
at-least-once worker execution must not duplicate points. Per-channel
permissions or deletion should not fail an entire guild, while NIM/Qdrant/Redis
outages should retry with bounded backoff and visible status.

This plan uses BullMQ for asynchronous work, MongoDB for durable run/channel
checkpoints, deterministic Qdrant upserts from Plan 003, and a first-enable
compare-and-set so repeated admin commands remain idempotent.

## Current state

- `package.json` already contains BullMQ `^5.80.10` and ioredis.
- `src/utils/redis.ts:7-17` creates one general Redis client with default
  `maxRetriesPerRequest`. BullMQ's Worker requires a connection configured with
  `maxRetriesPerRequest: null`; the command-facing Queue should fail quickly
  instead of waiting forever.
- `src/index.ts:88-90` creates a Discord client with only
  `GatewayIntentBits.Guilds`.
- `src/index.ts:105-121` registers ready/interaction/guild events but no worker
  lifecycle or signal-driven graceful shutdown.
- `src/config/command-handler.ts:9-22` and
  `src/events/interaction-create.ts:21-35` already enforce the custom
  `BotAdmin` and `PremiumOrTrial` command permissions.
- `src/commands/index.ts:33-65` manually registers commands in one array.
- Plan 003 supplies the fixed NIM adapter, Qdrant repository, memory config
  cache, point builder, and collection preflight.

Discord's official API constraints are load-bearing:

- message-history pages return newest-first with maximum `limit=100`;
- guild history requires `ViewChannel` and `ReadMessageHistory`;
- message content is empty without the privileged Message Content capability;
- discord.js manages REST rate-limit buckets, so the worker must bound
  concurrency but not add arbitrary sleeps.

## Exact enablement semantics

`/enable-memory` has:

```ts
requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial']
```

Behavior:

1. reply/defer ephemerally;
2. run Plan 003's NIM/Qdrant/config preflight;
3. atomically transition the guild from disabled to enabled;
4. on the first successful enable (`initialBackfillVersion < 1`), create a
   frozen run with cutoff and limits, then enqueue one guild backfill job;
5. on a repeat call while enabled, return current state/progress and enqueue
   nothing;
6. on a later re-enable after disable, set enabled/ready and do **not** repeat
   historical backfill, matching the first-enable-only requirement;
7. if queueing the first run fails, compare-and-set the config back to disabled
   with sanitized `queue_unavailable`, invalidate cache, and tell the admin to
   retry;
8. no raw messages are placed in Mongo or BullMQ job data.

Add `/memory-status`, authorized by `BotAdmin` and `GuildOnly` without a premium
gate, so an admin can inspect/repair state after a subscription expires.

Keep `/enable-memory` blocked unless `MEMORY_FEATURE_ENABLED=true`. Leave this
false through Plan 004 deployment; Plan 005 removes the rollout gap by adding
live ingestion.

## Backfill boundary

Freeze these values in every run:

- `cutoffAt = enabledAt - 365 days`;
- `maxScannedMessagesPerChannel = 50_000`;
- Discord page size `100`;
- NIM passage batch size from Plan 003, default `32`;
- backfill schema/version `1`.

For each eligible top-level text/announcement channel, scan newest to oldest
and stop at the first boundary reached:

1. the next message is older than `cutoffAt`; or
2. 50,000 total Discord messages have been inspected for that channel; or
3. Discord returns no more history.

The 50,000 cap is intentionally **messages scanned**, before filtering. This
keeps the REST/cost ceiling real on bot-heavy channels. Bot, webhook, system,
and blank messages increment `scannedCount` but not `eligibleMessageCount` or
`indexedChunkCount`.

V1 historical discovery includes `GuildText` and `GuildAnnouncement` only.
Forum/media parents have no direct history, and archived thread enumeration is
deferred. Plan 005 captures new thread messages.

## Durable checkpoint schema

Create two MongoDB models in `src/db/memoryBackfill.dal.ts`.

### Run

```ts
{
  guildId: string,
  version: 1,
  generation: number,
  jobId: string,
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completed_with_warnings'
    | 'failed'
    | 'cancelled',
  enabledAt: Date,
  cutoffAt: Date,
  maxScannedMessagesPerChannel: 50_000,
  discoveredChannelCount: number,
  completedChannelCount: number,
  skippedChannelCount: number,
  failedChannelCount: number,
  scannedCount: number,
  eligibleMessageCount: number,
  indexedChunkCount: number,
  startedAt: Date | null,
  completedAt: Date | null,
  lastHeartbeatAt: Date | null,
  lastErrorCode: string | null
}
```

Unique compound index: `{ guildId: 1, generation: 1, version: 1 }`.

### Channel checkpoint

```ts
{
  guildId: string,
  version: 1,
  generation: number,
  channelId: string,
  channelType: 'text' | 'announcement',
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed',
  beforeMessageId: string | null,
  scannedCount: number,
  eligibleMessageCount: number,
  indexedChunkCount: number,
  skippedMessageCount: number,
  lastProcessedMessageId: string | null,
  startedAt: Date | null,
  completedAt: Date | null,
  lastErrorCode: string | null
}
```

Unique compound index:
`{ guildId: 1, generation: 1, version: 1, channelId: 1 }`.

Do not store channel names, user names, message content, embeddings, HTTP
bodies, or stack traces in these documents.

## Queue topology and options

- Queue name: `memory-backfill-v1`.
- Job name: `guild-initial-backfill`.
- Job data: `{ guildId, generation, version: 1 }`.
- Job ID: `memory-backfill-<guildId>-g<generation>-v1` (BullMQ custom IDs must
  not contain `:`). Generation starts at 1 and is incremented only by an
  explicit successful purge in Plan 005, allowing a later clean re-enable
  without colliding with a retained completed job.
- Attempts: `5`.
- Backoff: exponential, seed 5 seconds, jitter 0.5.
- `removeOnComplete`: keep by age 7 days and count 1,000.
- `removeOnFail`: keep by age 30 days and count 5,000.
- Worker concurrency: environment
  `MEMORY_BACKFILL_CONCURRENCY`, default `3`, bounded `1..8`. (Higher defaults allow better perf on active guilds; rate limits are enforced by discord.js backpressure.)

Connections:

- producer: dedicated ioredis connection with
  `maxRetriesPerRequest: 1`, so `/enable-memory` can fail quickly;
- worker: dedicated ioredis connection with
  `maxRetriesPerRequest: null`;
- no ioredis `keyPrefix`; BullMQ owns its prefix;
- warn operationally if Redis does not use `maxmemory-policy=noeviction`, but
  do not attempt privileged configuration changes in code.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Unit tests | `node --import tsx --test src/tests/memory-backfill.test.ts` | all tests pass without Discord/NIM/Qdrant/Redis/Mongo |
| Build | `pnpm run build` | exit 0 |
| Queue ID audit | `rg -n "memory-backfill-" src/queues src/commands src/workers` | custom ID uses `-`, never `:` |
| Content persistence audit | `rg -n "content|embedding|vector" src/db/memoryBackfill.dal.ts src/queues/memory-backfill.queue.ts src/services/memory-backfill.service.ts` | no persisted content/vector fields, no raw messages in checkpoints or jobs |
| Diff hygiene | `git diff --check` | exit 0 |
| Typecheck | `pnpm exec tsc --noEmit` | no new backfill errors; only repository baseline may remain |

## Scope

**In scope:**

- `.env.example`
- `src/db/memoryBackfill.dal.ts` (create)
- `src/queues/memory-backfill.queue.ts` (create)
- `src/services/memory-backfill.service.ts` (create)
- `src/workers/memory-backfill.worker.ts` (create)
- `src/commands/admin/enable-memory.ts` (create)
- `src/commands/admin/memory-status.ts` (create)
- `src/commands/index.ts`
- `src/index.ts`
- `src/utils/redis.ts` — export URL/options helpers only; keep cache client
  behavior.
- `src/config/memory.ts` — add bounded backfill/feature-gate settings.
- `src/tests/memory-backfill.test.ts` (create)

**Out of scope:**

- live MessageCreate/Update/Delete handling;
- chat retrieval or history behavior;
- `/disable-memory` and purge (Plan 005);
- archived-thread historical discovery;
- attachments/embeds/OCR;
- storing message content outside Qdrant;
- separate worker deployment/container. V1 starts the asynchronous I/O worker
  in the bot process after Discord ready; it can be extracted later without
  changing queue contracts.

## Git workflow

- Suggested branch: `codex/004-memory-backfill`
- Suggested commits:
  1. `feat: add memory backfill checkpoints`
  2. `feat: queue guild memory backfill`
  3. `feat: add memory enable and status commands`
- Do not push/open a PR unless instructed.

## Steps

### Step 1: Add validated feature and worker settings

Extend `src/config/memory.ts` and `.env.example`:

```dotenv
MEMORY_FEATURE_ENABLED=false
MEMORY_BACKFILL_MAX_AGE_DAYS=365
MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL=50000
MEMORY_BACKFILL_CONCURRENCY=3
```

The default boundary values implement the requested product contract. Allow
lower positive values in development tests, but production values above the
defaults require explicit code/config review because they increase cost.

**Verify:** importing config with invalid negative/zero values returns a
sanitized config error and does not print environment values.

### Step 2: Add run and per-channel checkpoint DAL

Create `src/db/memoryBackfill.dal.ts` with the two schemas and indexes from
Durable checkpoint schema. Expose narrowly named operations:

- create/get run idempotently;
- mark run running/completed/failed/cancelled;
- upsert discovered channel checkpoints;
- claim or resume a channel;
- advance a channel cursor and counters atomically;
- mark channel completed/skipped/failed;
- recompute or atomically update run summary without double-counting a channel
  transition on retry.

Prefer deriving final counts with Mongo aggregation/query from channel docs at
completion over fragile increment-on-event logic.

**Verify:** tests show that repeating `mark completed` or replaying a checkpoint
does not double-count.

### Step 3: Create BullMQ producer and connection factories

Create `src/queues/memory-backfill.queue.ts`:

- lazy singleton Queue;
- producer connection with fast failure;
- exact job options and ID from Queue topology;
- `enqueueInitialBackfill(guildId, generation, version)`;
- `getInitialBackfillJob(...)` for status/retry diagnostics;
- `closeMemoryBackfillQueue()`.

Create the worker connection inside the worker module with
`maxRetriesPerRequest: null`. Do not pass the general cache Redis instance from
`src/utils/redis.ts` to Worker.

If a duplicate job ID exists, treat that as the existing run and return its
job reference/state; do not create a new version automatically.

**Verify:** fake-Queue tests assert job name/data/options and ID contains no
colon.

### Step 4: Implement first-enable compare-and-set and commands

Create `src/commands/admin/enable-memory.ts`:

1. declare command name `enable-memory` and permissions from Exact enablement
   semantics;
2. defer ephemerally;
3. return a clear unavailable message when feature gate is false;
4. run memory infrastructure preflight before changing Mongo;
5. call an AgentConfig service compare-and-set that returns one of:
   `first_enabled`, `re_enabled`, `already_enabled`, or `conflict`;
6. for first enable, create the frozen run/checkpoints metadata and enqueue;
7. if enqueue fails, safely roll the just-created transition back to disabled
   only when its job/version still matches;
8. return job ID, state, and `/memory-status` guidance; never claim indexing is
   complete.

Create `src/commands/admin/memory-status.ts`:

- fetch normalized AgentConfig, Mongo run summary, channel-state counts, and
  BullMQ job state if available;
- reply ephemerally with enabled/state, channels completed/total, scanned
  messages, eligible messages, indexed chunks, elapsed time, last heartbeat,
  and sanitized error code;
- calculate an **upper-bound** remaining-message count from channel count and
  per-channel cap; label any ETA as unavailable until observed throughput
  exists;
- do not show content, user IDs, channel names, or external response text.

Register both in `src/commands/index.ts`.

**Verify:** concurrent enable unit test resolves to one queued job and one
already-enabled response.

### Step 5: Enable required Discord capabilities and preflight permissions

In `src/index.ts`, add:

- `GatewayIntentBits.GuildMessages`;
- `GatewayIntentBits.MessageContent`.

The Message Content intent must also be enabled/approved in the Discord
Developer Portal; code cannot do this. Add a startup preflight log describing
whether a known readable channel returns non-empty content from a test only
when an operator explicitly runs it. Do not read arbitrary messages merely to
probe on every startup.

During channel discovery:

1. call `guild.channels.fetch()`;
2. include only top-level `GuildText` and `GuildAnnouncement`;
3. require bot member permissions `ViewChannel` and `ReadMessageHistory`;
4. create `skipped` checkpoints with `missing_permissions` instead of throwing;
5. use channel IDs/types only in checkpoints/logs.

**Deployment gate:** update deployment documentation/comment near
`MEMORY_FEATURE_ENABLED` stating it must stay false until:

- Message Content is enabled/approved;
- bot roles have ViewChannel + ReadMessageHistory where expected;
- Plan 005 live listeners are deployed.

### Step 6: Implement resumable channel pagination

Create `src/services/memory-backfill.service.ts` with dependency injection for
Discord page fetch, embedding batches, Qdrant upsert, config reads, checkpoints,
and clock.

For every channel:

1. load its checkpoint; resume with `beforeMessageId`;
2. fetch `{ limit: 100, before }`;
3. constrain the page so total inspected never exceeds 50,000;
4. stop before processing messages older than frozen `cutoffAt`;
5. increment scanned for every inspected Discord message;
6. filter and normalize eligible messages with Plan 003's shared predicate;
7. order them chronologically and pass them to Plan 003's shared
   `chunkMessages(...)` function. A page deliberately closes every chunk at
   its boundary: do not persist an open raw-text chunk in the Mongo checkpoint;
8. serialize chunks as passages, embed arrays of at most the configured batch
   size (default 32) using `input_type: "passage"`, and upsert the matching
   deterministic chunk-point batches with `wait: true`;
9. only after all chunk batches in the page are acknowledged, atomically save
   the oldest fetched message as the next `beforeMessageId` and update scanned,
   eligible-message, and indexed-chunk counts;
10. update BullMQ progress and run heartbeat;
11. check `memoryEnabled` between pages; if disabled, mark run cancelled and
    return without retrying.

If a process dies after Qdrant upsert but before checkpoint, retrying the page
must regenerate the same page-local chunks, upsert the same IDs, and produce
the same final state. Chunking does not cross fetched-page boundaries by design.

Classify errors:

- channel deleted or permission lost: mark that channel skipped/failed with
  sanitized code and continue;
- NIM 429/5xx/timeouts, Qdrant 5xx/timeouts, or transient Discord errors: throw
  `Error` so BullMQ retries the guild job from checkpoints;
- invalid credential, NIM response dimension, or Qdrant schema mismatch: mark
  run failed with a non-retryable sanitized code and do not hammer the service.

Do not log per message. Log start/end per guild and channel, plus throttled
progress at most once per 1,000 scanned messages or 60 seconds.

### Step 7: Start and stop the worker with the bot lifecycle

Create `src/workers/memory-backfill.worker.ts`:

- instantiate only after the Discord client is ready and memory config is
  available;
- resolve guild from `client.guilds.fetch(job.data.guildId)`;
- pass the client/guild and Plan 003 services into backfill service;
- update AgentConfig state:
  `backfilling` -> `ready`/`ready_with_warnings` and mark
  `initialBackfillVersion=1` on success, or `failed` only after final attempt;
- register `completed`, `failed`, `error`, and `stalled` metadata-only logs;
- export `closeMemoryBackfillWorker()` which awaits `worker.close()`.

Integrate worker start after `client.once(Events.ClientReady, ...)` in
`src/index.ts`. On SIGTERM/SIGINT:

1. set application closing flag;
2. await worker close with an operator-defined outer shutdown timeout;
3. close queue and BullMQ Redis connections;
4. then close Discord/general Redis/Mongo and flush Pino.

Do not use `QueueScheduler`; BullMQ 5 does not require it for stalled recovery.

### Step 8: Add comprehensive retry/boundary tests

Create `src/tests/memory-backfill.test.ts` with fakes. Cover:

1. first enable queues one job; repeated/concurrent enable queues none;
2. re-enable after a completed initial run performs no full backfill;
3. queue failure rolls back only the matching first-enable transition;
4. job ID contains no colon and job payload contains no content;
5. channel discovery filters type/permissions;
6. pagination cursor moves oldest-first correctly;
7. one-year boundary stops within a page;
8. 50,000 scanned boundary wins even if many messages are bots;
9. bot/webhook/system/blank messages are counted as scanned but not embedded;
10. page-local chunks honor author/gap/count/character boundaries, and a long
    single message remains one chunk;
11. NIM inputs and matching Qdrant upserts are chunk batches of at most 32 in
    passage mode;
12. Qdrant acknowledgement precedes checkpoint;
13. crash after upsert/before checkpoint replays deterministic chunk IDs safely;
14. completed/skipped counts are idempotent across retries;
15. disable/cancel state stops between pages;
16. transient error throws for BullMQ retry; permanent schema/auth/dimension
    errors stop retries;
17. status output exposes counts/state only.

**Verify:**

```sh
node --import tsx --test src/tests/memory-backfill.test.ts
pnpm run build
pnpm exec tsc --noEmit
git diff --check
```

Expected: tests/build/diff pass; no new in-scope type errors.

## Test plan

Use a private development guild and reduced environment limits
(`MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL=200`,
`MEMORY_BACKFILL_MAX_AGE_DAYS=7`) for integration:

1. enable once and verify command returns before the worker finishes;
2. issue enable twice and verify one BullMQ job/run;
3. restart the bot mid-channel and verify cursor resume;
4. force NIM 429/5xx in a test double and verify exponential retries;
5. remove ReadMessageHistory from one channel and verify
   `completed_with_warnings`;
6. verify bots/blank messages are not in Qdrant;
7. compare Mongo counts, BullMQ progress, and Qdrant point count for synthetic
   messages;
8. verify `/memory-status` changes queued -> running -> completed;
9. keep `MEMORY_FEATURE_ENABLED=false` in production after this test until Plan
   005 is complete.

## Done criteria

- [ ] `/enable-memory` requires BotAdmin + guild + premium/trial.
- [ ] First enable is atomic/idempotent and enqueues exactly one guild job.
- [ ] Repeat enable returns status without duplicate history work.
- [ ] Re-enable after first completion does not repeat full backfill.
- [ ] Queue failure safely rolls back first enable.
- [ ] Backfill stops at whichever comes first: 365 days or 50,000 scanned
      messages per channel.
- [ ] Only eligible human text is chunked and embedded; all inspected messages
      count toward the cap.
- [ ] NIM and Qdrant receive deterministic semantic chunks in batches of at
      most 32.
- [ ] Checkpoints advance only after acknowledged deterministic Qdrant chunk
      upserts.
- [ ] Process restart/retry resumes without duplicate points or counters.
- [ ] Channel permission/deletion issues do not fail unrelated channels.
- [ ] BullMQ producer/worker use appropriate separate Redis connections.
- [ ] Worker closes gracefully and jobs can recover from an ungraceful stop.
- [ ] Status reports counts/state/heartbeat with no message content.
- [ ] Logs are throttled, structured, and content-free.
- [ ] Message Content + GuildMessages intents are coded and Developer Portal
      enablement is documented as a deployment gate.
- [ ] `MEMORY_FEATURE_ENABLED` remains false until Plan 005 lands.
- [ ] Automated tests/build/diff pass and no new in-scope type errors exist.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Discord Message Content intent cannot be enabled/approved for this bot;
- product intent says “50,000” means 50,000 eligible non-bot messages rather
  than 50,000 total messages scanned;
- archived threads/forums must be part of initial v1 backfill;
- the deployment runs multiple bot replicas without a clear Discord shard/guild
  ownership model;
- Redis eviction policy cannot be made compatible with durable BullMQ state;
- a checkpoint would need to store raw message content;
- NIM rate/usage limits require a materially different batch size, concurrency,
  or global cap;
- Plan 003's collection/model validation does not pass.

## Maintenance notes

- The run/checkpoint separation avoids Mongo's 16 MiB document limit and lets
  status aggregate channel state safely.
- The first-enable-only rule intentionally leaves a gap for messages sent while
  memory is disabled later. If product wants catch-up on re-enable, create a
  separate bounded incremental scan plan.
- A dedicated worker process is a future deployment optimization. Keep queue
  data free of Discord Client objects so extraction is possible.
- Monitor actual NIM batch size, Qdrant storage, scanned/eligible/chunk ratios,
  retry counts, and skipped-channel ratios before increasing concurrency.

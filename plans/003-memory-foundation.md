# Plan 003: Add typed memory config, semantic chunking, NIM embeddings, and Qdrant storage

> **Executor instructions:** Implement only the foundation in this plan. Do not
> add the `/enable-memory` command, BullMQ workers, gateway message listeners,
> or `/chat` retrieval yet. Run every verification and stop on any STOP
> condition. Update `plans/README.md` when done.
>
> **Drift check (run first):**
>
> ```sh
> git diff --stat 327f0f1..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/db/aiAgentConfig.dal.ts src/utils/redis.ts src/index.ts src/utils/logger.ts
> git diff --stat -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/db/aiAgentConfig.dal.ts src/utils/redis.ts src/index.ts src/utils/logger.ts
> ```
>
> Expect user-owned dependency changes in the package and pnpm files. Plan 001
> must already be complete.

## Status

- **Priority:** P1
- **Effort:** L
- **Risk:** MED
- **Depends on:** `plans/001-pino-observability.md`
- **Category:** architecture / feature
- **Planned at:** commit `327f0f1`, 2026-07-24

## Why this matters

Historical backfill and live retrieval need one stable contract for server
configuration, embeddings, point IDs, payload isolation, Qdrant collection
shape, error classification, and logging. Implementing these concerns inside a
slash command or worker would make retries unsafe and make it easy to query one
guild/user's messages while serving another.

This plan creates that contract first. It fixes the NIM model and vector
dimension requested by the operator, turns many source messages into bounded
semantic chunks, batches up to 32 chunks per embedding/upsert request, creates
Qdrant filter indexes before data, and makes memory infrastructure optional so
an outage does not take down commerce commands.

## Current state

- `src/db/aiAgentConfig.dal.ts:3-52` already owns per-guild AI configuration,
  including `embeddingModel`, `retriverScroreThreshold`, and `retriverTopK`.
  The two retriever field names are misspelled.
- `src/db/aiAgentConfig.dal.ts:65-70` does a non-atomic find-then-create and
  returns a cast document. Concurrent first requests can race on the unique
  `guildId`.
- `src/commands/ai/chat.ts:45-46` loads this config directly on every command.
- `src/utils/redis.ts:19-67` caches store configuration under
  `storeConfigs:`. Memory must not be added to that commerce-specific object.
- The initial recon found no Qdrant JavaScript client, but the user-owned dirty
  dependency files now include `@qdrant/js-client-rest` `^1.18.0`. Preserve it;
  install only if it is absent when execution begins.
- The local environment has variable names `NIM_API_KEY`, `QDRANT_API_KEY`,
  and `QDRANT_API_URL`. `.env.example` does not document them.
- No code currently calls NIM or Qdrant.

The NIM endpoint contract for `nvidia/nemotron-3-embed-1b` is:

- `POST https://integrate.api.nvidia.com/v1/embeddings`;
- `input` accepts a string or array;
- max input length is 4,096 tokens;
- `input_type` is required: `passage` for indexing and `query` for retrieval;
- `encoding_format: "float"`;
- `truncate: "NONE"` must reject oversize content instead of silently losing
  text.

The operator-provided response establishes 2,048 float values per vector.

## Target module boundaries

```text
src/config/memory.ts
  Validated non-secret constants and environment access.

src/db/aiAgentConfig.dal.ts
  Guild-level memory flag, lifecycle summary, and retriever configuration.

src/services/agent-config.service.ts
  Read-through Redis cache and atomic memory config updates.

src/services/nim-embedding.service.ts
  Typed batch embeddings with passage/query mode and response validation.

src/services/qdrant-memory.service.ts
  Collection bootstrap, payload indexes, idempotent upsert/delete/query.

src/services/memory-chunk.service.ts
  Eligibility normalization, bounded source-message chunking, deterministic
  chunk IDs, Qdrant payload construction, and retrieval formatting primitives.
```

Do not collapse these into `src/utils`; they each hide a distinct external
contract.

## Data contracts

### Guild memory configuration

Extend `AgentConfig` with:

```ts
memoryEnabled: boolean; // default false
memoryState:
  | 'disabled'
  | 'queued'
  | 'backfilling'
  | 'ready'
  | 'ready_with_warnings'
  | 'purging'
  | 'purge_failed'
  | 'failed';
memoryEnabledAt: Date | null;
memoryDisabledAt: Date | null;
initialBackfillVersion: number; // default 0
initialBackfillCompletedAt: Date | null;
memoryGeneration: number; // default 1; increment only after an explicit purge
memoryLastErrorCode: string | null; // sanitized machine code, never raw body
retrieverScoreThreshold: number; // corrected name, default 0.5
retrieverTopK: number; // corrected name, default 4, range 1..10
```

Keep the legacy misspelled fields readable during one compatibility window:
normalized config uses corrected value, then legacy value, then default. New
writes use only corrected fields. Do not delete legacy data in this plan.

Use `findOneAndUpdate({ guildId }, { $setOnInsert: defaults }, { upsert: true,
new: true, setDefaultsOnInsert: true })` for atomic get-or-create.

### Qdrant collection

- Name: environment `QDRANT_MEMORY_COLLECTION`, default
  `discord_user_memory_v1`.
- Vector: unnamed dense vector, size `2048`, distance `Cosine`.
- A point represents one message chunk, never a single source message by
  default. A chunk contains consecutive eligible messages from the same
  `guildId`, `channelId`, and `userId`; it ends at 10 source messages, a
  five-minute inter-message gap, or roughly 1,800 characters before another
  source message is added. A single Discord message may exceed 1,800 characters
  and remains a one-message chunk; Discord's 2,000-character message limit
  stays safely below NIM's 4,096-token input limit.
- Point ID: deterministic UUID derived with Node `crypto` from
  `guildId/memoryGeneration/channelId/userId/firstMessageId/chunkSchemaVersion`.
  The first source-message ID is the stable chunk anchor: editing/deleting any
  source message rewrites or deletes the same point instead of creating a
  duplicate. No raw message content is placed in any checkpoint, Redis, BullMQ, or log.
- Payload:

```ts
{
  schemaVersion: 2,
  source: 'discord',
  guildId: string,
  memoryGeneration: number,
  userId: string,
  channelId: string,
  chunkSchemaVersion: 1,
  firstMessageId: string,
  lastMessageId: string,
  firstMessageAt: string, // RFC 3339 / ISO UTC
  lastMessageAt: string,
  sourceMessageIds: string[],
  sourceMessages: Array<{
    id: string,
    createdAt: string,
    editedAt: string | null,
    content: string,
  }>
}
```

- Payload indexes, created before ingestion:
  - `guildId`: keyword, tenant index if supported by the installed Qdrant
    server/client;
  - `memoryGeneration`: integer;
  - `userId`: keyword;
  - `channelId`: keyword;
  - `firstMessageId`: keyword;
  - `lastMessageId`: keyword;
  - `sourceMessageIds`: keyword; arrays are intentionally filterable so an
    edit/delete can locate all chunks containing a source message;
  - `firstMessageAt`: datetime;
  - `lastMessageAt`: datetime.
- Every semantic query requires exact-match conditions for `guildId`,
  `memoryGeneration`, and `userId`.
- Upserts use `wait: true` in v1 so a checkpoint never advances before Qdrant
  acknowledges the batch.
- Query returns payload, not vectors.

### Cache

- Key: `memory-config:v1:<guildId>`.
- TTL: 300 seconds.
- Value: only normalized runtime fields; no system prompt or secrets.
- Read path: Redis -> Mongo -> cache.
- Redis parse/read/write failure: log and fall back to Mongo.
- Update path: Mongo first, then invalidate/set cache. Mongo remains source of
  truth.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Verify/install client | `rg -n "\"@qdrant/js-client-rest\"" package.json || pnpm add @qdrant/js-client-rest` | dependency exists and existing lockfile changes are preserved |
| Unit tests | `node --import tsx --test src/tests/memory-foundation.test.ts` | all tests pass, no network |
| Build | `pnpm run build` | exit 0 |
| Chunk/batch audit | `rg -n "MEMORY_CHUNK|MEMORY_EMBED_BATCH_SIZE|chunkMessages" src/config/memory.ts src/services/memory-chunk.service.ts src/services/nim-embedding.service.ts` | bounded chunking and batch configuration are present |
| Isolation audit | `rg -n "guildId|memoryGeneration|userId" src/services/qdrant-memory.service.ts` | query filter contains all three fields |
| Diff hygiene | `git diff --check` | exit 0 |
| Typecheck | `pnpm exec tsc --noEmit` | no new errors in memory files; only baseline errors may remain |

## Scope

**In scope:**

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — preserve the
  user-owned Qdrant client; add it only if missing.
- `.env.example`
- `src/config/memory.ts` (create)
- `src/db/aiAgentConfig.dal.ts`
- `src/services/agent-config.service.ts` (create)
- `src/services/nim-embedding.service.ts` (create)
- `src/services/qdrant-memory.service.ts` (create)
- `src/services/memory-chunk.service.ts` (create)
- `src/index.ts` — optional, non-fatal infrastructure preflight only.
- `src/tests/memory-foundation.test.ts` (create)

**Out of scope:**

- BullMQ queues and workers;
- Discord intents/listeners and history pagination;
- `/enable-memory`, status, disable, or purge commands;
- changing `/chat`;
- profile summarization or fact extraction;
- attachments/embeds/OCR;
- quantization, custom shards, or one collection per guild;
- fixing global typecheck/lint baselines.

## Git workflow

- Suggested branch: `codex/003-memory-foundation`
- Suggested commits:
  1. `feat: add guild memory configuration`
  2. `feat: add nim and qdrant memory clients`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add and document the Qdrant client

First inspect:

```sh
rg -n "\"@qdrant/js-client-rest\"" package.json
```

At the final planning review this already returns
`"@qdrant/js-client-rest": "^1.18.0"`. If it is still present, do not run an
install that changes its version. Only if it is absent, run
`pnpm add @qdrant/js-client-rest`.

Add empty/defaulted names to `.env.example`:

```dotenv
NIM_API_KEY=
QDRANT_API_KEY=
QDRANT_API_URL=
QDRANT_MEMORY_COLLECTION=discord_user_memory_v1
MEMORY_EMBED_BATCH_SIZE=32
MEMORY_CHUNK_MAX_MESSAGES=10
MEMORY_CHUNK_MAX_CHARS=1800
MEMORY_CHUNK_MAX_GAP_SECONDS=300
MEMORY_EXTERNAL_TIMEOUT_MS=30000
```

Do not copy local values. Do not add the NIM key to URLs or logs.

**Verify:**

```sh
pnpm install --frozen-lockfile
rg -n "\"@qdrant/js-client-rest\"" package.json
```

Expected: both exit 0.

### Step 2: Create validated memory constants

Create `src/config/memory.ts`. Use Zod or explicit validation to expose:

```ts
export const NIM_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b';
export const NIM_EMBEDDING_DIMENSION = 2048;
export const NIM_EMBEDDINGS_URL =
  'https://integrate.api.nvidia.com/v1/embeddings';
export const DEFAULT_MEMORY_COLLECTION = 'discord_user_memory_v1';
```

Validate embed batch size as integer `1..64` with default 32, chunk maximum
messages as integer `1..20` with default 10, chunk character limit as integer
`512..2000` with default 1,800, gap seconds as integer `1..900` with default
300, and timeout as a positive bounded integer. Provide a function that reports missing
`NIM_API_KEY`, `QDRANT_API_URL`, and `QDRANT_API_KEY` as sanitized error codes.
Do not evaluate/throw at import time: non-memory bot features must be able to
start without these variables.

**Verify:**

```sh
node --import tsx -e "import('./src/config/memory.ts').then(m => console.log(m.NIM_EMBEDDING_MODEL, m.NIM_EMBEDDING_DIMENSION))"
```

Expected: fixed model name and `2048`.

### Step 3: Extend and normalize `AgentConfig`

Modify `src/db/aiAgentConfig.dal.ts` with the schema fields in Data contracts.
Set `embeddingModel` default to the fixed model string rather than an
environment-selected model. Keep `chatModel` behavior unchanged.

Replace find-then-create with atomic upsert. Export small DAL functions for:

- normalized get-or-create;
- compare-and-set lifecycle updates used by Plan 004;
- enabling/disabling and setting a sanitized state/error code;
- marking initial backfill version/completion.

Do not put channel checkpoint arrays in this model.

Create `src/services/agent-config.service.ts` for normalized return types and
Redis read-through cache. Include corrected-field compatibility in one
normalizer with tests.

**Verify:**

```sh
rg -n "memoryEnabled|memoryState|initialBackfillVersion|memoryGeneration|retrieverScoreThreshold|retrieverTopK" src/db/aiAgentConfig.dal.ts src/services/agent-config.service.ts
```

Expected: all fields appear; new code does not write misspelled field names.

### Step 4: Implement the NIM embedding adapter

Create `src/services/nim-embedding.service.ts` with dependency injection for
`fetch` and time:

```ts
embedPassages(inputs: string[]): Promise<number[][]>
embedQuery(input: string): Promise<number[]>
```

Both call the fixed endpoint and model. Body requirements:

```ts
{
  model: NIM_EMBEDDING_MODEL,
  input,
  input_type: 'passage' | 'query',
  encoding_format: 'float',
  truncate: 'NONE'
}
```

Requirements:

1. trim and reject empty inputs before the network;
2. use `AbortSignal.timeout` or an `AbortController` with the configured
   timeout;
3. send bearer authorization from `NIM_API_KEY`;
4. validate response with Zod:
   - `data.length === input.length`;
   - sort/map by `index`;
   - every vector length is exactly 2,048;
   - every element is a finite number;
5. classify 429 and 5xx as retryable, and 400/401/403/422 as non-retryable
   sanitized error codes;
6. never put input text, response body, token, or vectors in thrown error
   messages or logs;
7. do not silently truncate. The shared chunker constrains multi-message
   passages and accepts a one-message Discord chunk (at most 2,000 characters).
   If NIM still rejects an input as oversize, surface only a sanitized code so
   the worker can fail visibly rather than silently losing text.

The client itself may make one short jittered retry for 429/5xx on the
latency-sensitive query path. Long worker retry policy belongs to BullMQ in
Plan 004.

**Verify:** unit tests with injected fetch must confirm exact `input_type` and
model for passage and query.

### Step 5: Implement deterministic semantic chunks

Create `src/services/memory-chunk.service.ts` with pure functions:

- `isEligibleMemoryMessage(...)`;
- `normalizeMemorySourceMessage(...)`;
- `chunkMessages(messages, chunkOptions)`;
- `formatChunkForEmbedding(chunk)`;
- `createMemoryChunkPointId(chunkIdentity)`;
- `buildMemoryChunkPayload(chunk)`;
- `buildMemoryChunkPoint(chunk, vector)`;
- `formatChunkForRetrievedMemory(chunk)`.

Eligibility requires non-bot, non-webhook, non-system, non-empty human content.
Preserve source text, trimmed only at its ends, inside `sourceMessages` in the
Qdrant payload. Do not place source text in Mongo, Redis, BullMQ job data, or
logs.

`chunkMessages` receives chronological source messages from one channel. It
starts a new chunk whenever author changes, the gap exceeds configured seconds,
adding the next message would exceed the character limit, or the chunk already
has the configured source-message count. It must retain a single long Discord
message as a one-message chunk rather than dropping or truncating it. It must
not join messages across different users, channels, guilds, or generations.

For semantic embeddings, serialize every source message with its timestamp and
text, separated by a fixed delimiter. The exact serializer must be shared by
backfill, live mutation, and retrieval tests.

The deterministic UUID must:

- be stable across processes and retries;
- differ if guild, generation, channel, user, anchor message, or chunk schema
  version differs;
- satisfy Qdrant's UUID point-ID format;
- use only Node `crypto`; do not add another UUID dependency.

**Verify:** tests generate the same ID twice, distinct IDs for distinct chunk
identities, valid UUID strings, author/gap/size boundaries, and a long
one-message chunk.

### Step 6: Implement and bootstrap the Qdrant repository

Create `src/services/qdrant-memory.service.ts` around one lazily constructed
`QdrantClient({ url, apiKey })`. Expose:

- `ensureMemoryCollection()`;
- `upsertMemoryChunks(chunks)`;
- `deleteMemoryChunks(ids)`;
- `deleteGuildMemory(guildId)`;
- `deleteChunksBySourceMessageIds({ guildId, memoryGeneration, channelId, sourceMessageIds })`;
- `findChunksBySourceMessageIds({ guildId, memoryGeneration, channelId, sourceMessageIds })`;
- `findChannelUserChunksAround({ guildId, memoryGeneration, channelId, userId, from, to })`;
- `queryUserMemory({ guildId, memoryGeneration, userId, vector, topK, scoreThreshold })`;
- a read-only health/preflight function.

`ensureMemoryCollection()` must be concurrency-safe within a process:

1. inspect whether the collection exists;
2. create it with size 2,048 and cosine distance if absent;
3. if present, verify size/distance and STOP with a sanitized
   `collection_schema_mismatch` rather than deleting/recreating;
4. create the payload indexes from Data contracts before any points;
5. treat an "already exists" race as success after re-reading the schema.

`queryUserMemory` must call the current JS client's universal query method:

```ts
client.query(collectionName, {
  query: vector,
  filter: {
    must: [
      { key: 'guildId', match: { value: guildId } },
      { key: 'memoryGeneration', match: { value: memoryGeneration } },
      { key: 'userId', match: { value: userId } },
    ],
  },
  limit: topK,
  score_threshold: scoreThreshold,
  with_payload: true,
  with_vector: false,
});
```

Validate returned payloads before exposing them to chat code. Reject a payload
whose guild/generation/user does not exactly match the request even if Qdrant
returned it.

`findChannelUserChunksAround` must use the indexed channel/user/generation
filters and a bounded timestamp range over `firstMessageAt`/`lastMessageAt`.
It exists only for live reconciliation; it must return payloads without vectors.

**Verify:** unit tests with a fake client assert all three isolation filter
clauses, indexed `sourceMessageIds` filters, bounded channel/user window
filters, `with_vector: false`, deterministic chunk upsert IDs, and
delete-by-guild filter.

### Step 7: Add a non-fatal startup preflight

After Mongo and logger initialization in `src/index.ts`, invoke a memory
infrastructure preflight that:

- returns `available: false` with sanitized codes when variables are missing;
- attempts collection/index bootstrap when all variables exist;
- logs `memory.infrastructure.ready` or
  `memory.infrastructure.unavailable`;
- never logs endpoints with credentials or response bodies;
- never prevents Discord bot login when unavailable.

Plan 004's `/enable-memory` command will run the same preflight and refuse to
enable when unavailable.

**Verify:** start/build with all three memory credentials unset. Expected: bot
reaches its normal login path and logs memory as unavailable.

### Step 8: Add foundation tests and run all gates

Create `src/tests/memory-foundation.test.ts` covering:

- config defaults and sanitized missing-env codes;
- legacy retriever name normalization;
- atomic config update shape (DAL mocked);
- cache hit, cache miss, invalid JSON fallback, and Redis failure fallback;
- NIM passage/query request bodies;
- NIM response index ordering and dimension validation;
- NIM error classification without body/input leakage;
- message eligibility, chunk author/gap/count/size boundaries, and deterministic
  chunk UUID;
- a chunk source-message payload remains in Qdrant only and serializes
  identically for passage embedding/retrieval;
- Qdrant collection definition and payload-index definitions;
- mandatory guild+generation+user query filters;
- returned-payload tenant validation.

No test may contact NIM, Qdrant, Redis, or Mongo.

Run:

```sh
node --import tsx --test src/tests/memory-foundation.test.ts
pnpm run build
pnpm exec tsc --noEmit
git diff --check
```

Expected: tests/build/diff pass; no new in-scope type errors.

## Test plan

In addition to unit tests, run operator-controlled integration smokes:

1. call `ensureMemoryCollection()` twice; both calls succeed;
2. chunk several harmless synthetic source messages, embed the resulting
   passages as one NIM array, assert dimension 2,048, upsert the test chunks in
   one Qdrant call, embed a query as `query`, and retrieve with exact
   guild/generation/user filters;
3. delete the smoke point by ID;
4. query with a different guild or user and assert zero results;
5. run with a wrong Qdrant collection dimension in an isolated test
   collection and confirm bootstrap refuses to recreate it.

Use synthetic IDs/content only. Do not use real Discord messages in smoke
tests.

## Done criteria

- [ ] NIM model is fixed to `nvidia/nemotron-3-embed-1b`.
- [ ] Passage and query embeddings send the correct `input_type`.
- [ ] All returned vectors are validated as 2,048 finite floats.
- [ ] Qdrant collection is cosine/2,048 and never silently recreated on schema
      mismatch.
- [ ] Payload indexes exist before ingestion.
- [ ] Every retrieval filter includes exact `guildId` and `userId`.
- [ ] Point IDs are deterministic valid UUIDs anchored to a chunk's first
      source message.
- [ ] Source messages are chunked by author, gap, count, and character bounds;
      no memory point is created for each message by default.
- [ ] NIM and Qdrant receive chunks in arrays of at most 32.
- [ ] Mongo is source of truth; Redis cache is versioned, TTL-bound, and
      fallible.
- [ ] Agent config get-or-create is atomic.
- [ ] Remote failures contain sanitized codes and no user content/secrets.
- [ ] Startup remains available without memory infrastructure.
- [ ] `node --import tsx --test src/tests/memory-foundation.test.ts` passes.
- [ ] `pnpm run build` and `git diff --check` exit 0.
- [ ] No new TypeScript errors occur in in-scope files.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- “generate memory” means LLM-synthesized profile facts rather than bounded,
  semantically searchable source-message chunks;
- the live NIM model returns a dimension other than 2,048;
- the existing Qdrant collection name already exists with a non-2,048 or
  non-cosine schema;
- Qdrant cannot create keyword/datetime payload indexes before ingestion;
- the installed Qdrant server is too old for the universal query API or tenant
  payload index and no compatible typed fallback exists;
- secrets are embedded in `QDRANT_API_URL` in a way the logger would expose;
- completing this plan requires starting backfill or modifying `/chat`.

## Maintenance notes

- The fixed model and collection schema are version-coupled. A future embedding
  model change requires a new collection/version and reindex plan, not an
  in-place dimension change.
- Raw source-message content lives only inside Qdrant chunk payloads; do not
  duplicate it in Mongo checkpoints, Redis, BullMQ job data, or logs.
- Corrected retriever names should be migrated and legacy fields removed only
  after one release confirms compatibility.
- Revisit quantization after measuring real chunk count, payload size, and
  recall. The requested worst-case raw vector footprint is large.

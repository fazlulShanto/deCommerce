# User Memory and Logging Implementation Plans

Generated on 2026-07-24 against commit `327f0f1`. These plans are written for
an executor with no context from the planning conversation. Execute them in the
order below unless the dependency column says they may be parallelized.

The repository had pre-existing, user-owned dependency changes when these plans
were written:

- `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` already add
  BullMQ, Pino, `@logtail/pino`, `@qdrant/js-client-rest`, and the
  `msgpackr-extract` build approval.
- Preserve those changes. Do not reset, regenerate, or replace the lockfiles
  with another package manager.
- Qdrant credentials and a NIM credential exist in the local environment, but
  secret values were not read or copied into these plans.

## Architecture decision summary

- Memory is opt-in per Discord guild and authorized through the existing
  `BotAdmin` permission path.
- MongoDB is the source of truth for the guild flag and backfill state. Redis
  holds a short-lived read-through cache and BullMQ state.
- The existing `AgentConfig` document is the server-level home for AI/memory
  configuration. Backfill checkpoints use a separate MongoDB collection so the
  config document does not grow with channel count and progress updates.
- Qdrant uses one shared collection, `discord_user_memory_v1`, with 2,048
  dimensional cosine vectors. Every query must filter by `guildId`,
  `memoryGeneration`, and `userId`; these payload fields are indexed before
  ingestion.
- One memory point is a bounded semantic chunk of consecutive eligible messages
  from one user in one channel: at most 10 messages, a five-minute gap, and
  about 1,800 characters before a new chunk begins. Its deterministic point ID
  derives from the guild, generation, channel, user, and first source message.
  This lets BullMQ retry an upsert safely without making one vector per message.
- NVIDIA NIM model is fixed to `nvidia/nemotron-3-embed-1b`.
  Indexing calls use `input_type: "passage"` and retrieval calls use
  `input_type: "query"`. The official NIM API says this distinction is required
  for retrieval quality and accepts string arrays for batching.
- Initial history scans top-level text and announcement channels visible to the
  bot. A channel stops at whichever happens first: 365 days old or 50,000
  Discord messages scanned. Eligible messages are assembled into chunks, then
  NIM and Qdrant receive batches of at most 32 chunks. Bot, webhook/bot-authored,
  system, and empty-content messages count toward the scan cap but are not part
  of a chunk. Archived thread discovery is deferred from v1; live thread
  messages are supported.
- Backfill and live ingestion use separate BullMQ queues so a year-long scan
  cannot starve new messages.
- Live gateway mutations are debounced per guild/channel/generation for 15
  seconds in an ID-and-mutation-only Redis buffer. One delayed BullMQ flush
  reconciles up to 100 IDs at a time, then embeds/upserts changed chunks in
  batches of at most 32. Redis and BullMQ never receive source text. Discord REST
  rate limits are managed exclusively by `discord.js` (no manual sleeps, delays, or sleeps added); worker concurrency is bounded via environment config.
- The bot continues to run and `/chat` continues without memory when NIM,
  Qdrant, or Redis memory infrastructure is temporarily unavailable.
- Raw messages, prompts, embeddings, API keys, and authorization headers must
  never be logged. No raw Discord message content is ever stored in MongoDB checkpoints, Redis buffers, BullMQ jobs, logs, or any other persistent store; only metadata, IDs, and timestamps are persisted. Source text lives exclusively in Qdrant chunk payloads and is never read back into logs or other systems.

## Scale and privacy notes

A 2,048-element float32 vector is 8,192 bytes before payload, HNSW, and database
overhead. Chunking reduces the normal vector count substantially, although a
channel of long or non-consecutive messages can still approach the 50,000-point
worst case (about 390 MiB raw per channel). The implementation must report
scanned messages, eligible messages, chunks, and observed throughput; it must
not promise an ETA before work begins.

Server-wide memory can carry a user's own statement from a private source
channel into a public `/chat` response. The safe v1 policy in these plans is:

1. Ingest every readable guild text message as requested.
2. At retrieval time, include a point only when the invoking member can still
   view its source channel.
3. Make `/chat` replies ephemeral whenever guild memory is enabled (or its state
   cannot be read safely before Discord's acknowledgement deadline). Tool side
   effects such as announcements and polls retain their own existing permission
   checks.

If public `/chat` responses with cross-channel memory are a product requirement,
STOP before Plan 005 and obtain an explicit alternative disclosure policy.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| [001](./001-pino-observability.md) | Replace ad-hoc logging with structured Pino and Better Stack transport | P1 | M | — | IN PROGRESS |
| [002](./002-six-message-chat-history.md) | Send exactly the six latest eligible human channel messages to `/chat` | P1 | S | — | DONE |
| [003](./003-memory-foundation.md) | Add typed memory config, NIM embeddings, and Qdrant storage/retrieval | P1 | L | 001 | DONE |
| [004](./004-memory-backfill.md) | Implement `/enable-memory` and resumable BullMQ historical backfill | P1 | L | 003 | IN PROGRESS |
| [005](./005-live-memory-and-chat-retrieval.md) | Keep memory current and retrieve it safely during `/chat` | P1 | L | 002, 004 | IN PROGRESS |

Status values: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED: <reason>` |
`REJECTED: <reason>`.

## Dependency notes

- Plans 001 and 002 are independent and may be implemented in parallel.
- Plan 003 depends on Plan 001 so all external-service calls use the structured
  logger from their first commit.
- Plan 004 depends on Plan 003's config, clients, deterministic point builder,
  and collection bootstrap.
- Plan 005 depends on Plan 004's memory state and queue lifecycle, and on Plan
  002's final chat-history shape.

## Repository verification baseline

Run these before each plan and preserve the observed baseline:

| Command | Baseline at `327f0f1` |
|---|---|
| `pnpm run build` | exits 0 |
| `pnpm exec tsc --noEmit` | exits 2 with four existing errors in `src/events/interaction-create.ts` and `src/handlers/modal-handlers.ts` |
| `pnpm exec eslint src` | exits 2 because `eslint.config.js` is treated as an empty config and ignores `src` |
| `git diff --check` | exits 0 |

The four existing TypeScript errors are:

- `src/events/interaction-create.ts`: `TopLevelComponent.components` access and
  an implicitly-`any` callback parameter.
- `src/handlers/modal-handlers.ts`: Zod v4 `ZodError.errors` access and an
  implicitly-`any` callback parameter.

Do not expand any plan to fix this baseline unless the operator separately
authorizes it. Every plan still requires `pnpm run build`, targeted tests, and
no **new** TypeScript errors in its in-scope files.

## External references used by all memory plans

- [Discord message content and channel-history requirements](https://docs.discord.com/developers/resources/message)
- [Discord Message Content privileged intent](https://docs.discord.com/developers/events/gateway#message-content-intent)
- [NVIDIA NIM nemotron-3-embed-1b API](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-embed-1b-infer)
- [Qdrant JavaScript quickstart](https://qdrant.tech/documentation/quick-start/)
- [Qdrant payload filtering](https://qdrant.tech/documentation/search/filtering/)
- [Qdrant query-points API](https://api.qdrant.tech/api-reference/search/query-points/)
- [BullMQ connections](https://docs.bullmq.io/guide/connections)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ retries and backoff](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)
- [Better Stack Pino transport](https://betterstack.com/docs/logs/javascript/pino/)

## Deliberately deferred

- Synthesized user-profile facts, memory consolidation, contradiction
  resolution, or LLM-written summaries. These plans implement semantic recall
  over source messages because no profile-generation model or fact schema was
  specified.
- Historical archived-thread enumeration. It has a separate pagination and
  capacity profile; live thread messages are still indexed after enablement.
- Image/OCR, attachment body extraction, embed text, reactions, voice, and DMs.
- Qdrant quantization or custom sharding. Measure the first production backfill
  before choosing these.
- A global per-guild message cap. The requested limit is per channel. Add a
  global cap only after product approval because it changes coverage.

## Findings considered and rejected

- **Store the memory flag in `store_configs`:** rejected because memory is AI
  agent configuration and `AgentConfig` already owns embedding/retrieval
  settings. Coupling it to commerce currency/admin-role configuration would
  force unrelated cache and schema changes.
- **Run embeddings inside Discord event handlers:** rejected because external
  latency and retries would directly affect gateway event processing.
- **One embedding/vector upsert per message:** rejected because it creates
  excessive NIM/Qdrant calls. History uses shared chunks and 32-item batches;
  live mutations first coalesce for 15 seconds in an ID-only Redis buffer, then
  the flush worker processes changed chunks in the same 32-item batches.
- **Use one BullMQ queue for both historical and live messages:** rejected
  because a long historical job could delay current-message ingestion.
- **One Qdrant collection per guild or user:** rejected because a shared
  collection with indexed `guildId`, `memoryGeneration`, and `userId` filters
  is simpler to operate and is Qdrant's documented multitenancy pattern.
- **Manually sleep between Discord requests:** rejected because discord.js
  already manages Discord REST rate-limit buckets. Concurrency is bounded in
  the queue worker instead.

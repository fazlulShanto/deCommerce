# Plan 001: Replace ad-hoc logging with structured Pino and Better Stack transport

> **Executor instructions:** Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report it; do not improvise. On completion,
> update this plan's row in `plans/README.md`.
>
> **Drift check (run first):**
>
> ```sh
> git diff --stat 327f0f1..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/utils/logger.ts src/index.ts src/events src/config src/services src/commands src/handlers src/ai-tools
> git diff --stat -- package.json pnpm-lock.yaml pnpm-workspace.yaml .env.example src/utils/logger.ts src/index.ts src/events src/config src/services src/commands src/handlers src/ai-tools
> ```
>
> The second command is expected to show the user-owned Pino/BullMQ dependency
> changes described in `plans/README.md`. Preserve them.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** none
- **Category:** DX / observability
- **Planned at:** commit `327f0f1`, 2026-07-24

## Why this matters

The repository has a custom logger that awaits direct HTTP calls and Discord
webhook calls, while most runtime paths still use `console.*`. Its environment
names do not match the currently configured source token, so remote delivery is
not reliable. Memory backfills will run for hours and call Discord, NIM,
Qdrant, MongoDB, and Redis; without consistent event names, correlation IDs,
latencies, and counts, operators cannot tell whether a job is progressing,
rate-limited, retrying, or stuck.

This plan installs one application-wide Pino logger, uses Better Stack's
documented `@logtail/pino` transport, keeps stdout as a fallback, and defines
the privacy rules that all later memory plans rely on.

## Current state

- `package.json:41-55` already contains user-owned additions for
  `@logtail/pino`, `bullmq`, and `pino`. Do not reinstall a different version.
- `src/utils/logger.ts:24-248` implements an async singleton that:
  - defaults to an `"online"` destination;
  - performs direct `fetch` calls to environment names not present in the
    current environment;
  - optionally duplicates logs into Discord;
  - serializes stack traces into a permissive `LogContext`.
- `src/events/guild-join.ts:8-14`,
  `src/events/guild-leave.ts:6-12`,
  `src/commands/admin/extend-trial.ts:36-91`,
  `src/commands/admin/revoke-subscription.ts`, and
  `src/utils/cronJobs.ts:13-25` await the custom logger API.
- `src/index.ts`, `src/events/interaction-create.ts`, database/Redis startup,
  command handlers, AI tools, and several services still use `console.*`.
- `src/events/interaction-create.ts:37-40` does not await
  `command.execute(...)`, which prevents a top-level command-completion log
  from measuring success or duration.
- The actual environment exposes a token variable named
  `LOG_SERVER_API_KEY`; `.env.example` currently documents neither that token
  nor an ingest URL. Secret values must not be copied.

Follow the repository's current TypeScript conventions:

- path aliases such as `@/utils/logger` are used in source;
- environment loading happens before runtime service construction;
- command-level context uses `guildId` and `userId`;
- use `type` imports where appropriate to satisfy the intended ESLint config.

## Target logging contract

Use the native Pino object-first call shape:

```ts
logger.info(
  {
    event: 'memory.backfill.channel.completed',
    guildId,
    channelId,
    jobId,
    scannedCount,
    eligibleMessageCount,
    indexedChunkCount,
    durationMs,
  },
  'Memory channel backfill completed',
);

logger.error(
  {
    event: 'chat.command.failed',
    err,
    guildId,
    userId,
    interactionId,
  },
  'Chat command failed',
);
```

Every structured event must have:

- `event`: stable dot-separated machine name;
- `service: "decommerce-bot"` and `environment` in the logger base fields;
- relevant identifiers (`guildId`, `userId`, `channelId`, `interactionId`,
  `jobId`) and numeric counts/durations;
- an `err` value for errors so Pino's standard error serializer is used.

Never log:

- Discord message content, prompts, chat history, retrieved memory text,
  attachments, or user display names;
- embeddings or embedding-response bodies;
- cookies, authorization headers, API keys, source tokens, webhook URLs, JWTs,
  or environment-variable values;
- complete Mongo/Qdrant documents when they include content payloads.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0; user-owned lockfile remains consistent |
| Build | `pnpm run build` | exit 0 |
| Logger tests | `node --import tsx --test src/tests/logger.test.ts` | all tests pass |
| Console audit | `rg -n "console\\.(log|warn|error|debug)" src --glob '*.ts'` | no matches outside explicitly documented bootstrap fallback inside `src/utils/logger.ts` |
| Diff hygiene | `git diff --check` | exit 0 |
| Full typecheck | `pnpm exec tsc --noEmit` | no new errors; only the four baseline errors listed in `plans/README.md` may remain |

Do not use `pnpm lint` as a completion gate for this plan. The repository's
active `eslint.config.js` is a pre-existing empty-config script and currently
ignores `src`.

## Scope

**In scope:**

- `src/utils/logger.ts` — replace the custom class with Pino construction,
  redaction, serializers, and flush/close helpers.
- `.env.example` — add names only for logging configuration.
- `src/index.ts` and `src/events/interaction-create.ts` — startup, shutdown,
  correlation, and command lifecycle.
- Existing source files that contain `console.log`, `console.warn`,
  `console.error`, or calls to the old async `logger` API at plan time:
  `src/config/command-register.ts`, `src/db/connection.ts`,
  `src/utils/redis.ts`, `src/utils/cronJobs.ts`,
  `src/services/premium.service.ts`, `src/services/giveaway.service.ts`,
  `src/events/guild-join.ts`, `src/events/guild-leave.ts`,
  `src/commands/admin/extend-trial.ts`,
  `src/commands/admin/revoke-subscription.ts`,
  `src/commands/admin/giveaway.ts`, `src/commands/ai/chat.ts`,
  `src/commands/utility/salesStats.ts`, `src/commands/sales/buy.ts`,
  `src/commands/delivery/deliveryProduct.ts`,
  `src/commands/payments/paymentMethodDetails.ts`,
  `src/commands/payments/deletePaymentMethod.ts`,
  `src/commands/products/listProducts.ts`,
  `src/commands/products/productDetails.ts`,
  `src/commands/products/deleteProduct.ts`,
  `src/commands/order/cancelOrder.ts`,
  `src/commands/order/confirmOrder.ts`,
  `src/commands/order/createOrder.ts`,
  `src/commands/order/listOrders.ts`, `src/commands/order/myOrder.ts`,
  `src/commands/order/orderDetails.ts`, `src/ai-tools/announcement.ts`,
  `src/ai-tools/poll.ts`, `src/handlers/btn-interaction-handlers.ts`.
- `src/tests/logger.test.ts` — create focused tests.

**Out of scope:**

- memory-specific logs; Plans 003-005 add those using this contract;
- logging raw Discord or AI content;
- Better Stack dashboards, alerts, retention, or billing settings;
- Discord webhook logging; remove this destination rather than preserving a
  second remote logging implementation;
- fixing the existing TypeScript or ESLint baselines;
- OpenTelemetry tracing.

## Git workflow

- Suggested branch: `codex/001-pino-observability`
- Preserve the uncommitted package/lockfile changes that were present at plan
  time.
- Use the repository's short imperative commit style, for example:
  `feat: add structured pino logging`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace `Logger` with a configured Pino instance

Rewrite `src/utils/logger.ts` around `pino` and `@logtail/pino`:

1. Export `logger`, `flushLogger()`, and `closeLogger()`.
2. Configure base fields:
   `service: "decommerce-bot"` and
   `environment: process.env.NODE_ENV ?? "development"`.
3. Use `process.env.LOG_LEVEL ?? "info"`.
4. Always include a stdout stream. When both
   `LOG_SERVER_API_KEY` and `BETTERSTACK_INGESTING_URL` exist, add the Better
   Stack transport:
   `pino.transport({ target: "@logtail/pino", options: { sourceToken,
   options: { endpoint } } })`.
5. Construct the transport once at module load. Do not create a transport per
   log call.
6. Use Pino's error serializer for `err`.
7. Configure `redact` with `censor: "[REDACTED]"` for at least:
   `authorization`, `headers.authorization`, `cookie`, `headers.cookie`,
   `token`, `apiKey`, `sourceToken`, `password`, `jwt`, `embedding`, `vector`,
   `content`, `prompt`, `chatHistory`, and `memoryContext`, including common
   nested paths such as `req.headers.authorization`.
8. If the remote transport cannot be constructed, keep stdout alive and write
   one sanitized startup warning. Do not crash the bot solely because logging
   export is unavailable.

Do not retain `LogDestination`, direct `fetch`, Discord webhook formatting, or
the awaitable `Logger` class.

**Verify:**

```sh
node --import tsx -e "import('./src/utils/logger.ts').then(({logger}) => logger.info({event:'logger.smoke'}, 'logger smoke'))"
```

Expected: exit 0 and one JSON log on stdout; it must not require Better Stack
environment values.

### Step 2: Document non-secret configuration

Add these names to `.env.example`, with empty values:

```dotenv
LOG_LEVEL=
LOG_SERVER_API_KEY=
BETTERSTACK_INGESTING_URL=
```

`BETTERSTACK_INGESTING_URL` is the full HTTPS ingest URL. Do not hardcode the
workspace's source-specific host into source code or the plan implementation.
Do not add `--insecure`; TLS verification must remain enabled.

**Verify:**

```sh
rg -n "^(LOG_LEVEL|LOG_SERVER_API_KEY|BETTERSTACK_INGESTING_URL)=" .env.example
```

Expected: exactly three matches and no credential values.

### Step 3: Add logger unit tests

Create `src/tests/logger.test.ts` with Node's built-in `node:test` and
`node:assert/strict`. Refactor logger construction into an exported factory only
if needed to inject a destination safely.

Test:

1. structured fields and `event` are emitted as JSON;
2. an `Error` passed under `err` includes its type/message without throwing;
3. configured sensitive keys are replaced with `[REDACTED]`;
4. missing Better Stack variables falls back to stdout/test destination;
5. no test performs a network call.

**Verify:**

```sh
node --import tsx --test src/tests/logger.test.ts
```

Expected: all tests pass with zero network access.

### Step 4: Migrate startup, infrastructure, and scheduled logs

Update the scoped infrastructure files to Pino's native call shape. Use stable
events such as:

- `app.starting`, `app.ready`, `app.shutdown.started`,
  `app.shutdown.completed`, `app.unhandled_rejection`,
  `app.uncaught_exception`;
- `mongodb.connected`, `mongodb.connection.failed`;
- `redis.connected`, `redis.connection.failed`;
- `discord.commands.registration.started`,
  `discord.commands.registration.completed`,
  `discord.commands.registration.failed`;
- `premium.cache.refresh.completed`, `premium.cache.refresh.failed`;
- `giveaway.scheduler.failed`;
- `guild.joined`, `guild.left`.

Remove emoji-dependent free-form status strings from the machine field; the
human message can remain readable.

Add SIGTERM/SIGINT shutdown handling in `src/index.ts` that stops accepting new
work, closes future BullMQ workers via a registry hook added in Plans 004-005,
closes Redis/Mongo/Discord resources as applicable, calls `flushLogger()`, and
then exits. For this plan, the worker registry may be an empty no-op function;
do not import memory modules that do not exist yet.

**Verify:**

```sh
rg -n "console\\.(log|warn|error|debug)" src/index.ts src/config src/db src/utils src/events src/services
```

Expected: no matches except a single last-resort logger-construction fallback,
if the implementation needs one.

### Step 5: Add command correlation and migrate command/tool errors

In `src/events/interaction-create.ts`:

1. Create an interaction child logger with `guildId`, `userId`,
   `interactionId`, and `commandName`.
2. Log `discord.command.started`.
3. Await `command.execute(...)`.
4. Log `discord.command.completed` with `durationMs`.
5. Log `discord.command.failed` with `err` and `durationMs` in the catch path.
6. Keep user-facing Discord error text generic; never send stack traces.

Update every other scoped `console.*` and old `await logger.*` call to the Pino
shape. Use event names appropriate to the operation and identifier fields
instead of interpolating IDs into messages.

Do not log slash-command option values because `/chat` options contain user
content.

**Verify:**

```sh
rg -n "await logger\\.|console\\.(log|warn|error|debug)" src --glob '*.ts'
```

Expected: no old awaited logger calls; no `console.*` outside the documented
last-resort logger fallback.

### Step 6: Verify Better Stack in a non-production smoke run

With the operator's existing environment loaded, emit one event:

```sh
node --import tsx -e "import('./src/utils/logger.ts').then(async ({logger,flushLogger}) => { logger.info({event:'betterstack.smoke', smoke:true}, 'Better Stack smoke'); await flushLogger(); })"
```

Expected:

- process exits 0;
- JSON appears on stdout;
- the event appears in Better Stack Live tail when credentials are configured;
- the event contains no token, endpoint authorization header, message content,
  or environment dump.

If network access is unavailable in the executor environment, record this smoke
check as requiring an operator run; do not weaken TLS or print credentials.

## Test plan

- `src/tests/logger.test.ts` covers local serialization, errors, redaction,
  fallback, and no-network construction.
- Run a command success and failure in a development Discord guild if a bot
  token is available. Confirm the two logs share `interactionId`.
- Confirm a `/chat` log does not contain the message option value.
- Confirm startup succeeds when Better Stack variables are unset.
- Confirm `pnpm run build` resolves the transport target in the current tsup
  external-dependency setup.

## Done criteria

- [ ] `pnpm run build` exits 0.
- [ ] `node --import tsx --test src/tests/logger.test.ts` passes.
- [ ] `git diff --check` exits 0.
- [ ] No new TypeScript errors occur in modified files.
- [ ] `rg -n "await logger\\.|console\\.(log|warn|error|debug)" src` returns no
      old calls except the documented emergency fallback.
- [ ] Logger output is structured JSON with stable `event` fields.
- [ ] Sensitive-field redaction is covered by a passing test.
- [ ] Better Stack is optional at startup and uses the official Pino transport
      when configured.
- [ ] No message, prompt, embedding, vector, token, cookie, JWT, or header value
      is logged.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- the user-owned dependency/lockfile changes have disappeared or conflict with
  a different Pino major version;
- `@logtail/pino` cannot be resolved from the production tsup output without
  bundling secrets or copying arbitrary source files;
- the transport requires disabling TLS verification;
- migrating command completion requires changing user-facing command behavior
  beyond awaiting the existing promise;
- a logging requirement asks for Discord message content, prompts, embeddings,
  authorization data, or secrets;
- the implementation appears to require fixing the unrelated TypeScript or
  ESLint baselines.

## Maintenance notes

- Later plans must reuse these event and redaction conventions rather than
  creating memory-specific logger wrappers.
- Review Pino/transport shutdown behavior after BullMQ workers are added; close
  workers before flushing the logger.
- Better Stack transport processing runs off the main event loop through
  Pino's transport API, but the stdout stream still needs normal container log
  rotation.
- Review `LOG_LEVEL` and Better Stack retention operationally; neither belongs
  in source code.

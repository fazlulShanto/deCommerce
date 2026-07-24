# Plan 002: Send the six latest eligible human channel messages to `/chat`

> **Executor instructions:** Follow this plan step by step and run every
> verification. Stop on a STOP condition; do not broaden scope. Update the
> status row in `plans/README.md` when complete.
>
> **Drift check (run first):**
>
> ```sh
> git diff --stat 327f0f1..HEAD -- src/commands/ai/chat.ts src/services/chat.service.ts src/config/command-handler.ts
> git diff --stat -- src/commands/ai/chat.ts src/services/chat.service.ts src/config/command-handler.ts
> ```

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** LOW
- **Depends on:** none
- **Category:** feature / correctness
- **Planned at:** commit `327f0f1`, 2026-07-24

## Why this matters

The current `/chat` implementation fetches only 20 messages, guesses that a bot
message immediately following a human message is an assistant reply, and then
keeps ten mixed user/assistant entries. That does not satisfy the requested
contract: the model should receive the latest six **non-bot messages** from the
current channel as conversation history. The adjacent-bot heuristic can also
attribute unrelated bot output to this AI.

This plan makes the rule explicit, supports guild text channels beyond the
concrete `TextChannel` class, keeps messages in chronological order, and moves
selection into a small service that can be tested without calling Discord.

## Current state

`src/commands/ai/chat.ts:60-95` currently does the following:

```ts
const fetched = await interaction.channel.messages.fetch({ limit: 20 });
const chronological = Array.from(fetched.values()).reverse();
// ...
chatHistory.push({ role: 'user', content: msg.content });
if (botReply) {
  chatHistory.push({ role: 'assistant', content: botReply });
}
chatHistory = chatHistory.slice(-10);
```

`src/services/chat.service.ts:10-13` defines the shape consumed by the AI SDK:

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
```

`src/services/chat.service.ts:58-61` places the history before the current slash
command's `message` option. Slash-command interactions do not create a normal
channel message, so the current prompt is not duplicated by the history fetch.

## Exact history contract

- Source: the channel in which `/chat` was invoked.
- Count: up to six latest eligible messages; exactly six when six exist within
  the bounded recent-history scan.
- Eligibility:
  - guild message;
  - human author (`author.bot === false`);
  - not webhook-authored;
  - not a Discord system message;
  - non-empty trimmed textual `content`.
- Excluded: all bot messages, including this bot's old replies; webhooks;
  system messages; attachment-only messages; embeds; slash-command options.
- Ordering: oldest to newest among the selected six.
- AI role: every selected entry has role `user`; do not synthesize assistant
  turns.
- Attribution: format content as `<display name>: <message content>` so six
  messages from different users remain a conversation rather than appearing to
  come from the invoker. Prefer guild display name, then global name, then
  username. Do not log the formatted content.
- Channel support: guild text, announcement, and thread channels that expose a
  message manager. DMs remain unsupported by the guild-only command.
- Bounded scan: fetch Discord pages of 100 newest-first until six eligible
  messages are found, history is exhausted, or 500 total messages have been
  inspected. If the channel contains fewer than six eligible messages within
  this bound, pass the available messages and continue; do not delay `/chat`
  indefinitely in a bot-only channel.
- Fetch failure: log metadata only and continue with an empty history. A
  channel-history failure must not fail the AI response.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| History tests | `node --import tsx --test src/tests/chat-history.test.ts` | all tests pass |
| Build | `pnpm run build` | exit 0 |
| Old heuristic audit | `rg -n "botReply|slice\\(-10\\)|limit: 20|instanceof TextChannel" src/commands/ai/chat.ts` | no matches |
| Diff hygiene | `git diff --check` | exit 0 |
| Full typecheck | `pnpm exec tsc --noEmit` | no new errors in chat/history files; only baseline errors from `plans/README.md` may remain |

## Scope

**In scope:**

- `src/services/chat-history.service.ts` — create the bounded Discord fetch and
  pure selection/formatting helpers.
- `src/commands/ai/chat.ts` — call the service and remove the old pairing loop.
- `src/services/chat.service.ts` — only if a small type adjustment is needed;
  do not change model/provider behavior.
- `src/tests/chat-history.test.ts` — create focused unit tests.

**Out of scope:**

- memory embeddings or retrieval;
- changing the `/chat` option, model, system prompt, tool calls, temperature,
  or response chunking;
- persisting conversation history;
- indexing attachments or embeds;
- changing public/ephemeral reply behavior; Plan 005 handles memory privacy;
- fixing global typecheck/lint baselines.

## Git workflow

- Suggested branch: `codex/002-six-message-chat-history`
- Suggested commit: `fix: send six human messages to chat`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Create a testable recent-history service

Create `src/services/chat-history.service.ts` with:

1. a `RecentMessageLike` structural type containing only the fields selection
   needs;
2. an exported pure function that filters, selects the latest six, reverses
   them into chronological order, and maps them to `ChatMessage`;
3. an exported Discord adapter,
   `fetchRecentHumanChatHistory(channel, options?)`, that paginates
   `channel.messages.fetch({ limit: 100, before })`;
4. constants `CHAT_HISTORY_LIMIT = 6`, `CHAT_HISTORY_PAGE_SIZE = 100`, and
   `CHAT_HISTORY_SCAN_LIMIT = 500`.

Do not use `instanceof TextChannel`; discord.js channel subclasses and partials
make capability checks safer. Require a guild text-based channel with a
`messages.fetch` manager.

Within a page:

- messages arrive newest-first;
- inspect each returned message only once;
- stop collecting after six eligible messages, but maintain correct
  chronological output;
- move `before` to the oldest fetched message ID for the next page;
- stop if the page is shorter than the requested page size.

Keep Discord I/O out of the pure selector so tests do not need a client.

**Verify:**

```sh
node --import tsx -e "import('./src/services/chat-history.service.ts').then(m => console.log(m.CHAT_HISTORY_LIMIT))"
```

Expected output contains `6` and exits 0.

### Step 2: Replace the command's mixed-turn heuristic

In `src/commands/ai/chat.ts`:

1. remove the `TextChannel` import;
2. remove lines that build bot/user pairs and `slice(-10)`;
3. call `fetchRecentHumanChatHistory(interaction.channel)` when the current
   channel supports guild text history;
4. catch history-fetch errors separately from the outer chat-generation catch;
5. log only `guildId`, `channelId`, inspected count if exposed, and the error;
   never log history content;
6. pass the resulting `ChatMessage[]` unchanged to
   `handleChatMessageGeneration`.

If Plan 001 has not landed, use the existing logger API only temporarily and
leave a clear integration note in the commit. Do not introduce a new logger.
If Plan 001 has landed, use its Pino contract.

**Verify:**

```sh
rg -n "botReply|slice\\(-10\\)|limit: 20|instanceof TextChannel" src/commands/ai/chat.ts
```

Expected: no matches.

### Step 3: Add selection and pagination tests

Create `src/tests/chat-history.test.ts` using `node:test` and
`node:assert/strict`. Cover:

1. eight human messages produce the newest six in oldest-to-newest order;
2. interleaved bot messages are absent and do not become assistant turns;
3. webhook, system, blank, and attachment-only messages are excluded;
4. display-name fallback order is correct;
5. a first page with fewer than six eligible messages causes a second fetch
   with the oldest ID as `before`;
6. scanning stops after six eligible messages;
7. scanning stops at 500 inspected messages and returns what it found;
8. fewer than six available messages are returned without padding;
9. a simulated fetch rejection returns/throws according to the service
   contract, and the command-level adapter test confirms `/chat` can continue
   with `[]`.

Use small fake objects and an injected `fetchPage` function. Do not connect to
Discord or the network.

**Verify:**

```sh
node --import tsx --test src/tests/chat-history.test.ts
```

Expected: all tests pass.

### Step 4: Run build and a development-guild smoke test

Run:

```sh
pnpm run build
pnpm exec tsc --noEmit
git diff --check
```

Expected:

- build exits 0;
- typecheck adds no chat/history errors;
- diff check exits 0.

In a development Discord guild, place at least eight human messages with bot
messages interleaved, then invoke `/chat`. Temporarily inspect the request with
a local test double if needed; do **not** log content in production. Confirm the
AI SDK receives six user-role history entries in chronological order followed
by the current slash-command prompt.

## Test plan

The automated cases above are the primary regression suite. The smoke test
should additionally cover:

- normal text channel;
- thread channel;
- channel where the bot lacks `ReadMessageHistory` (chat continues without
  history);
- a bot-heavy channel that requires pagination.

## Done criteria

- [ ] Latest six eligible human messages are sent, oldest to newest.
- [ ] Bot/webhook/system/blank messages never enter chat history.
- [ ] No assistant turns are inferred from adjacent bot messages.
- [ ] The current slash-command prompt remains the final user message and is not
      duplicated.
- [ ] History scan is bounded at 500 inspected messages.
- [ ] History-fetch failure degrades to empty history instead of failing chat.
- [ ] `node --import tsx --test src/tests/chat-history.test.ts` passes.
- [ ] `pnpm run build` and `git diff --check` exit 0.
- [ ] No new TypeScript errors occur in in-scope files.
- [ ] No message content is logged.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- product intent is to include previous bot/assistant replies despite the
  explicit “six non-bot messages” requirement;
- “last six” is intended to mean only the invoking user's messages rather than
  all human participants in the current channel;
- the current channel cannot expose a message manager without adding new
  privileged intents (Plan 004 owns intent/deployment changes);
- implementing the selector requires changing AI provider behavior or storing
  messages.

## Maintenance notes

- Plan 005 will combine this local conversation history with semantically
  retrieved long-term memory. Keep them as distinct inputs so local recency and
  long-term relevance can be inspected separately.
- If Discord later increases message-page limits, retain the 500-message scan
  cap unless latency measurements justify a change.
- If attribution becomes structured in the AI SDK, remove the textual
  `<display name>:` prefix in one coordinated change with tests.

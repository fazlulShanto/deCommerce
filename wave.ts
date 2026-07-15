import 'dotenv/config';

import { createInterface } from 'node:readline/promises';

import { generateText, type ModelMessage } from 'ai';
import { WAVE_MODEL_ID, WAVE_TIMEOUT_MS, waveModel } from './src/utils/aiConfig.js';

const SYSTEM_PROMPT =
  'You are an AI assistant designed to assist users by providing clear, ' +
  'concise, and helpful responses.';

const TEMPERATURE = 0.9;
const MAX_OUTPUT_TOKENS = 200;
const EXIT_COMMANDS = new Set([':q', ':quit', 'exit', 'quit']);

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '(none)';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        // It looked like JSON but was ordinary text.
      }
    }
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? '(unserializable value)';
  } catch {
    return '(unserializable value)';
  }
}

function indent(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : ''))
    .join('\n');
}

function formatConversation(messages: ModelMessage[]): string[] {
  const lines: string[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      lines.push('USER', indent(formatValue(message.content)), '');
      continue;
    }

    if (message.role === 'assistant') {
      lines.push(`ASSISTANT (${WAVE_MODEL_ID})`);
      if (typeof message.content === 'string') {
        if (message.content.trim()) lines.push(indent(message.content), '');
        continue;
      }

      for (const part of message.content) {
        if (part.type === 'text' && part.text.trim()) lines.push(indent(part.text), '');
        if (part.type === 'reasoning') {
          lines.push('  [thinking]', indent(part.text, '    '), '');
        }
      }
    }
  }

  return lines;
}

function printAgentResult(
  result: Awaited<ReturnType<typeof generateText>>,
  messages: ModelMessage[],
): void {
  const header = '═'.repeat(60);
  const divider = '─'.repeat(60);
  const conversation = formatConversation(messages);

  const lines = [
    header,
    ' Agent Result',
    header,
    '',
    'FINAL OUTPUT',
    indent(formatValue(result.text)),
  ];

  if (conversation.length > 0) {
    lines.push('', divider, ' Conversation', divider, '', ...conversation);
  }

  lines.push(
    '',
    divider,
    ' Usage',
    divider,
    '',
    `  requests: ${result.steps.length}`,
    `  input:    ${(result.totalUsage.inputTokens ?? 0).toLocaleString()} tokens`,
    `  output:   ${(result.totalUsage.outputTokens ?? 0).toLocaleString()} tokens`,
  );

  const cacheRead = result.totalUsage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = result.totalUsage.inputTokenDetails.cacheWriteTokens ?? 0;
  if (cacheRead || cacheWrite) {
    lines.push(
      `  cache:    read ${cacheRead.toLocaleString()}, write ${cacheWrite.toLocaleString()}`,
    );
  }

  console.log(lines.join('\n').trimEnd());
}

async function runTurn(prompt: string, history: ModelMessage[]): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [...history, { role: 'user', content: prompt }];
  const result = await generateText({
    model: waveModel,
    system: SYSTEM_PROMPT,
    messages,
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeout: WAVE_TIMEOUT_MS,
  });
  const updatedHistory = [...messages, ...result.response.messages];

  printAgentResult(result, updatedHistory);

  console.log(`History messages retained: ${updatedHistory.length}`);
  return updatedHistory;
}

async function handlePrompt(prompt: string, history: ModelMessage[]): Promise<ModelMessage[]> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return history;

  const command = normalizedPrompt.toLowerCase();
  if (command === ':clear') {
    console.log('History cleared.');
    return [];
  }

  return runTurn(normalizedPrompt, history);
}

async function main(): Promise<void> {
  let history: ModelMessage[] = [];
  const initialPrompt = process.argv.slice(2).join(' ') || process.env.WAVE_PROMPT;

  if (initialPrompt) history = await runTurn(initialPrompt, history);

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });

  try {
    if (process.stdin.isTTY) {
      console.log('Enter messages. Use :quit to exit, :clear to reset history.');

      while (true) {
        const prompt = (await readline.question('You: ')).trim();
        if (EXIT_COMMANDS.has(prompt.toLowerCase())) break;
        history = await handlePrompt(prompt, history);
      }
      return;
    }

    for await (const line of readline) {
      const prompt = line.trim();
      if (EXIT_COMMANDS.has(prompt.toLowerCase())) break;
      history = await handlePrompt(prompt, history);
    }
  } finally {
    readline.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

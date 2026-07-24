import 'dotenv/config';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const WAVE_MODEL_ID = process.env.WANDB_MODEL ?? 'coreweave/moonshotai/Kimi-K2.6';
export const WAVE_TIMEOUT_MS = Number(process.env.WANDB_TIMEOUT ?? 120) * 1_000;

const WANDB_BASE_URL = process.env.WANDB_BASE_URL ?? 'https://trace.wandb.ai';
const WANDB_PROJECT_ID = process.env.WANDB_PROJECT_ID ?? 'fazlulcse17-/quickstart_playground112';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function normalizeCookieHeader(cookieHeader: string): string {
  const value = cookieHeader.trim().replace(/^(?:"|')|(?:"|')$/g, '');
  return value.toLowerCase().startsWith('cookie:')
    ? value.slice(value.indexOf(':') + 1).trim()
    : value;
}

function getWandbHeaders(): Record<string, string> {
  const cookie = normalizeCookieHeader(
    process.env.WANDB_COOKIE_HEADER ??
      process.env.WANDB_COOKIE ??
      process.env.PROVIDER_COOKIE ??
      '',
  );

  if (!cookie) {
    throw new Error(
      "Set WANDB_COOKIE_HEADER in .env. The value may include the 'Cookie:' prefix or just the cookie string.",
    );
  }

  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,ar;q=0.7',
    Authorization: 'Basic Og==',
    'Content-Type': 'application/json',
    Origin: 'https://wandb.ai',
    Cookie: cookie,
  };
}

function normalizeUsage(usage: unknown): JsonRecord {
  if (!isRecord(usage)) {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }

  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Number(usage.total_tokens ?? promptTokens + completionTokens),
  };
}

function normalizeChoice(choice: unknown, index: number): JsonRecord {
  if (!isRecord(choice)) {
    return {
      index,
      message: { role: 'assistant', content: stringifyUnknown(choice) },
      finish_reason: 'stop',
    };
  }

  const message: JsonRecord = isRecord(choice.message)
    ? { ...choice.message }
    : { role: 'assistant', content: stringifyUnknown(choice.message) };

  message.role ??= 'assistant';
  message.content ??= choice.text ?? choice.content ?? '';

  return {
    index: choice.index ?? index,
    message,
    finish_reason: choice.finish_reason ?? 'stop',
  };
}

function extractText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!isRecord(data)) return stringifyUnknown(data);

  for (const key of ['content', 'text', 'message']) {
    if (typeof data[key] === 'string') return data[key];
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const choice = normalizeChoice(data.choices[0], 0);
    const message = choice.message;
    if (isRecord(message) && typeof message.content === 'string') return message.content;
  }

  return JSON.stringify(data);
}

function openAITextResponse(text: string, modelName: string): JsonRecord {
  return {
    id: `wandb-${process.hrtime.bigint()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1_000),
    model: modelName,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function normalizeToOpenAIChatCompletion(data: unknown, modelName: string): JsonRecord {
  let candidate = data;

  for (const key of ['completion', 'response', 'result', 'output']) {
    if (isRecord(candidate) && (isRecord(candidate[key]) || typeof candidate[key] === 'string')) {
      candidate = candidate[key];
      break;
    }
  }

  if (isRecord(candidate) && Array.isArray(candidate.choices)) {
    return {
      id: candidate.id ?? `wandb-${process.hrtime.bigint()}`,
      object: candidate.object ?? 'chat.completion',
      created: candidate.created ?? Math.floor(Date.now() / 1_000),
      model: candidate.model ?? modelName,
      choices: candidate.choices.map(normalizeChoice),
      usage: normalizeUsage(candidate.usage),
    };
  }

  return openAITextResponse(extractText(candidate), modelName);
}

const wandbFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  if (!url.pathname.endsWith('/chat/completions') && !url.pathname.endsWith('/completions')) {
    return fetch(request);
  }

  const openAIPayload = (await request.clone().json()) as JsonRecord;
  const inputs = Object.fromEntries(
    Object.entries(openAIPayload).filter(([, value]) => value !== undefined && value !== null),
  );
  const modelName = typeof inputs.model === 'string' ? inputs.model : WAVE_MODEL_ID;

  inputs.model ??= modelName;
  inputs.messages ??= [];
  if ('max_completion_tokens' in inputs && !('max_tokens' in inputs)) {
    inputs.max_tokens = inputs.max_completion_tokens;
    delete inputs.max_completion_tokens;
  }

  const body = JSON.stringify({
    project_id: WANDB_PROJECT_ID,
    inputs,
    track_llm_call: false,
    source: 'decommerce',
  });

  url.pathname = '/completions/create';
  url.search = '';

  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(getWandbHeaders())) headers.set(name, value);
  headers.delete('content-length');

  const response = await fetch(url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });

  if (!response.ok) return response;

  const responseData: unknown = await response.json();
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(JSON.stringify(normalizeToOpenAIChatCompletion(responseData, modelName)), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

/** A callable AI SDK provider: `wave(modelId)`. */
export const wave = createOpenAICompatible({
  name: 'wandb-trace',
  baseURL: WANDB_BASE_URL,
  fetch: wandbFetch,
});

/** The default Kimi model, ready for `generateText`, `streamText`, and AI SDK agents. */
export const waveModel: LanguageModel = wave(WAVE_MODEL_ID);

/** Get another W&B-hosted model using the same transport. */
export function getWaveModel(modelId = WAVE_MODEL_ID): LanguageModel {
  return wave(modelId);
}

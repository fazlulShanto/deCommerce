import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';

import { getWaveModel, WAVE_MODEL_ID, WAVE_TIMEOUT_MS } from '@/utils/aiConfig.js';

export interface UserContext {
  name: string;
  roles: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions<TOOLS extends ToolSet = ToolSet> {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  userContext?: UserContext;
  serverContext?: Record<string, unknown>;
  chatHistory?: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  tools?: TOOLS;
}

/**
 * Generate a chat response with Wave and return the complete AI SDK result.
 */
export async function handleChatMessageGeneration<TOOLS extends ToolSet = ToolSet>(
  options: ChatOptions<TOOLS>,
) {
  const {
    model = WAVE_MODEL_ID,
    systemPrompt,
    userMessage,
    userContext,
    serverContext = {},
    chatHistory = [],
    temperature = 0.9,
    maxOutputTokens = 5200,
    timeoutMs = WAVE_TIMEOUT_MS,
    tools,
  } = options;

  // Append user context to the system prompt if provided
  let fullSystemPrompt = systemPrompt;
  if (userContext) {
    fullSystemPrompt +=
      `\n\n## Current User\nName: ${userContext.name}` +
      (Object.keys(serverContext).length
        ? `\nServer Context: ${JSON.stringify(serverContext)}`
        : '') +
      (userContext.roles.length ? `\nRoles: ${userContext.roles.join(', ')}` : '');
  }

  const messages: ModelMessage[] = [
    ...chatHistory.map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user' as const, content: userMessage },
  ].filter((message) => message.content.trim() !== '');

  return generateText({
    model: getWaveModel(model),
    system: fullSystemPrompt,
    messages,
    temperature,
    // maxOutputTokens,
    timeout: timeoutMs,
    tools,
    stopWhen: stepCountIs(5),
  });
}

export type ChatGenerationResult = Awaited<ReturnType<typeof handleChatMessageGeneration>>;

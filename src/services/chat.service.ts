import { generateText } from 'ai';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ALLOWED_OLLAMA_MODELS } from '@/utils/constants';

export interface UserContext {
  name: string;
  roles: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  fallbackModel?: string;
  systemPrompt: string;
  userMessage: string;
  userContext?: UserContext;
  serverContext?: Record<string, any>;
  chatHistory?: ChatMessage[];
  temperature?: number;
}
const ollamaProvider = createOpenAICompatible({
  name: 'ollama',
  apiKey: process.env.OLLAMA_KEY,
  baseURL: 'https://ollama.com/v1/',
  includeUsage: true, // Include usage information in streaming responses
});

/**
 * Generate a chat response using the AI SDK with Ollama.
 * Falls back to the fallback model if the primary fails.
 */
export async function handleChatMessageGeneration(options: ChatOptions): Promise<string> {
  const {
    model = 'gemma3:27b',
    systemPrompt,
    userMessage,
    userContext,
    serverContext = {},
    chatHistory = [],
    temperature = 0.5,
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

  const messages = [
    { role: 'system' as const, content: fullSystemPrompt },
    // Inject prior turns (user + assistant pairs) as chat history
    ...chatHistory.map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user' as const, content: userMessage },
  ].filter((msg) => msg.content && msg.content.trim() !== ''); // Remove empty messages

  try {
    const response = await generateText({
      model: ollamaProvider(ALLOWED_OLLAMA_MODELS.includes(model) ? model : 'gemma3:27b'),
      messages,
      temperature,
    });
    return response.text;
  } catch (error) {
    throw error;
  }
}

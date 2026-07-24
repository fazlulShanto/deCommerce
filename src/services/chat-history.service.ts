import type { Message } from 'discord.js';
import type { ChatMessage } from '@/services/chat.service.js';

export const CHAT_HISTORY_LIMIT = 20;
export const CHAT_HISTORY_PAGE_SIZE = 100;
export const CHAT_HISTORY_SCAN_LIMIT = 500;

export interface RecentMessageLike {
  author: {
    bot: boolean;
    globalName?: string | null;
    username: string;
  };
  content: string;
  id: string;
  attachments?: { size: number };
  embeds?: any[];
  type?: number;
  webhookId?: string;
}

function isEligibleHumanMessage(message: RecentMessageLike): boolean {
  return (
    !message.author.bot &&
    message.content.trim() !== '' &&
    (!message.attachments || message.attachments.size === 0) &&
    (!message.embeds || message.embeds.length === 0) &&
    (!message.type || message.type === 0) &&
    !message.webhookId
  );
}

export function selectHumanChatHistory(messages: RecentMessageLike[]): ChatMessage[] {
  // Newest-first input becomes chronological context for the model.
  const eligible = messages.filter(isEligibleHumanMessage).slice(0, CHAT_HISTORY_LIMIT);
  const chronological = [...eligible].reverse();
  return chronological.map((msg) => ({
    role: 'user' as const,
    content: formatMessage(msg),
  }));
}

function formatMessage(msg: RecentMessageLike): string {
  const name = msg.author.globalName ?? msg.author.username;
  return `${name}: ${msg.content}`;
}

export async function fetchRecentHumanChatHistory(
  channel: any,
  options: {
    limit?: number;
    scanLimit?: number;
    fetchPage?: (before?: string) => Promise<any>;
  } = {},
): Promise<ChatMessage[]> {
  const limit = options.limit ?? CHAT_HISTORY_LIMIT;
  const scanLimit = options.scanLimit ?? CHAT_HISTORY_SCAN_LIMIT;
  const fetchPage =
    options.fetchPage ||
    ((before?: string) => {
      const fetchOptions = before
        ? { limit: CHAT_HISTORY_PAGE_SIZE, before }
        : { limit: CHAT_HISTORY_PAGE_SIZE };
      return channel.messages.fetch(fetchOptions);
    });

  const collected: RecentMessageLike[] = [];
  let beforeId: string | undefined = undefined;
  let inspected = 0;

  while (collected.length < limit && inspected < scanLimit) {
    const fetched = await fetchPage(beforeId);
    const page = Array.from(fetched.values() as Message[]); // newest-first

    for (const message of page) {
      if (inspected >= scanLimit || collected.length >= limit) break;
      inspected += 1;
      const candidate: RecentMessageLike = {
        author: {
          bot: Boolean(message.author.bot),
          globalName: message.author.globalName,
          username: message.author.username,
        },
        content: message.content,
        id: message.id,
        attachments: { size: message.attachments?.size ?? 0 },
        embeds: message.embeds ?? [],
        type: message.type ?? 0,
        webhookId: message.webhookId ?? undefined,
      };
      if (isEligibleHumanMessage(candidate)) collected.push(candidate);
    }

    if (page.length < CHAT_HISTORY_PAGE_SIZE || page.length === 0) {
      break;
    }

    if (page.length > 0) {
      beforeId = page[page.length - 1].id;
    }
  }

  return selectHumanChatHistory(collected);
}

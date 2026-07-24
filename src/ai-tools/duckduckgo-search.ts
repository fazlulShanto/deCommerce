import { tool } from 'ai';
import { z } from 'zod';
import { searchDuckDuckGo } from 'ts-duckduckgo-search';

export function createDuckDuckGoSearchTool() {
  return tool({
    description:
      'Search the web using DuckDuckGo for the latest information on any topic. ' +
      'Use this tool when the user asks for current events, news, real-time data, ' +
      'or information not covered in your knowledge cutoff.',
    inputSchema: z.object({
      query: z.string().trim().min(1).describe('The search query for DuckDuckGo'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe('Maximum number of results to return (default 10, max 20)'),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        const results = await searchDuckDuckGo(query, { maxResults });
        return {
          success: true,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            description: r.description,
          })),
          query,
        };
      } catch (error) {
        console.error('❌ DuckDuckGo search failed:', error);
        return {
          success: false,
          error: 'Failed to perform the search. Please try again or rephrase your query.',
        };
      }
    },
  });
}

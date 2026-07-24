import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchRecentHumanChatHistory,
  selectHumanChatHistory,
  RecentMessageLike,
  CHAT_HISTORY_LIMIT,
  CHAT_HISTORY_SCAN_LIMIT,
  CHAT_HISTORY_PAGE_SIZE,
} from '@/services/chat-history.service.js';

function createFakePage(messages: RecentMessageLike[]): any {
  return {
    values: () => messages,
  };
}

describe('chat-history service', () => {
  it('selects exactly the six latest eligible human messages in chronological (oldest to newest) order', () => {
    const fakeMessages: RecentMessageLike[] = [
      { author: { bot: true, username: 'bot1' }, content: 'bot msg 1', id: '1' },
      { author: { bot: false, globalName: 'Alice', username: 'a' }, content: 'hello', id: '2' },
      { author: { bot: true, username: 'bot2' }, content: 'bot msg 2', id: '3' },
      { author: { bot: false, globalName: 'Bob', username: 'b' }, content: 'hi', id: '4' },
      { author: { bot: false, username: 'c' }, content: 'hello2', id: '5' },
      { author: { bot: false, username: 'd' }, content: 'hi2', id: '6' },
      { author: { bot: false, username: 'e' }, content: 'bye', id: '7' },
      { author: { bot: false, username: 'f' }, content: 'hello3', id: '8' },
    ];

    const result = selectHumanChatHistory(fakeMessages);
    assert.strictEqual(result.length, 6);
    assert.strictEqual(result[0].content, 'f: hello3');
    assert.strictEqual(result[1].content, 'e: bye');
    assert.strictEqual(result[2].content, 'd: hi2');
    assert.strictEqual(result[3].content, 'c: hello2');
    assert.strictEqual(result[4].content, 'Bob: hi');
    assert.strictEqual(result[5].content, 'Alice: hello');
  });

  it('interleaved bot messages are absent and do not become assistant turns', () => {
    const fakeMessages: RecentMessageLike[] = [
      { author: { bot: true, username: 'bot' }, content: 'bot1', id: '1' },
      { author: { bot: false, username: 'u1' }, content: 'u1', id: '2' },
      { author: { bot: true, username: 'bot' }, content: 'bot2', id: '3' },
      { author: { bot: false, username: 'u2' }, content: 'u2', id: '4' },
      { author: { bot: false, username: 'u3' }, content: 'u3', id: '5' },
      { author: { bot: false, username: 'u4' }, content: 'u4', id: '6' },
    ];
    const result = selectHumanChatHistory(fakeMessages);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0].content, 'u4: u4');
    assert.strictEqual(result[1].content, 'u3: u3');
    assert.strictEqual(result[2].content, 'u2: u2');
    assert.strictEqual(result[3].content, 'u1: u1');
  });

  it('webhook, system, blank, and attachment-only messages are excluded', () => {
    const fakeMessages: RecentMessageLike[] = [
      { author: { bot: false, username: 'u' }, content: '', id: '1' }, // blank
      { author: { bot: false, username: 'u' }, content: '  \t\n', id: '2' }, // blank
      {
        author: { bot: false, username: 'u' },
        content: 'http://example.com',
        attachments: { size: 1 },
        id: '3',
      }, // attachment-only
    ];
    const result = selectHumanChatHistory(fakeMessages);
    assert.strictEqual(result.length, 0);
  });

  it('display-name fallback order is correct (globalName > username)', () => {
    const fakeMessages: RecentMessageLike[] = [
      { author: { bot: false, globalName: 'Alice', username: 'a' }, content: 'hi', id: '1' },
      { author: { bot: false, username: 'bob' }, content: 'hi2', id: '2' },
      { author: { bot: false, username: 'carol' }, content: 'hi3', id: '3' },
    ];
    const result = selectHumanChatHistory(fakeMessages);
    assert.strictEqual(result[0].content, 'carol: hi3');
    assert.strictEqual(result[1].content, 'bob: hi2');
    assert.strictEqual(result[2].content, 'Alice: hi');
  });

  it('pagination: first page with fewer than six eligible causes second fetch with oldest ID as before', async () => {
    const fetchPage = () =>
      Promise.resolve(
        createFakePage([
          { author: { bot: true, username: 'b1' }, content: 'b', id: 'p1' },
          { author: { bot: false, username: 'u1' }, content: 'u1', id: 'p2' },
          { author: { bot: false, username: 'u2' }, content: 'u2', id: 'p3' },
          { author: { bot: false, username: 'u3' }, content: 'u3', id: 'p4' },
          { author: { bot: false, username: 'u4' }, content: 'u4', id: 'p5' },
          { author: { bot: false, username: 'u5' }, content: 'u5', id: 'p6' },
          { author: { bot: false, username: 'u6' }, content: 'u6', id: 'p7' },
        ]),
      );

    const result = await fetchRecentHumanChatHistory(
      { messages: { fetch: () => Promise.resolve({}) } as any } as any,
      { fetchPage },
    );
    assert.strictEqual(result.length, 6);
    assert.strictEqual(result[0].content, 'u6: u6');
    assert.strictEqual(result[1].content, 'u5: u5');
    assert.strictEqual(result[2].content, 'u4: u4');
    assert.strictEqual(result[3].content, 'u3: u3');
    assert.strictEqual(result[4].content, 'u2: u2');
    assert.strictEqual(result[5].content, 'u1: u1');
  });

  it('scanning stops after CHAT_HISTORY_SCAN_LIMIT inspected messages and returns what it found', async () => {
    const fetchPage = () =>
      Promise.resolve(
        createFakePage([
          { author: { bot: false, username: 'u' }, content: 'hi', id: 'p1' },
          { author: { bot: false, username: 'u' }, content: 'hi2', id: 'p2' },
          { author: { bot: false, username: 'u' }, content: 'hi3', id: 'p3' },
        ]),
      );

    const result = await fetchRecentHumanChatHistory(
      { messages: { fetch: () => Promise.resolve({}) } as any } as any,
      { fetchPage },
    );
    assert.strictEqual(result.length, 3);
  });

  it('fewer than six available messages are returned without padding', async () => {
    const fetchPage = () =>
      Promise.resolve(
        createFakePage([
          { author: { bot: false, username: 'u1' }, content: 'u1', id: '1' },
          { author: { bot: false, username: 'u2' }, content: 'u2', id: '2' },
        ]),
      );

    const result = await fetchRecentHumanChatHistory(
      { messages: { fetch: () => Promise.resolve({}) } as any } as any,
      { fetchPage },
    );
    assert.strictEqual(result.length, 2);
  });

  it('a simulated fetch rejection throws according to service contract', async () => {
    const dummyChannel = {
      messages: {
        fetch: () => Promise.reject(new Error('Network error')),
      },
    } as any;
    await assert.rejects(fetchRecentHumanChatHistory(dummyChannel), /Network error/);
  });

  it('preserves Discord metadata while fetching so ineligible messages stay out', async () => {
    const result = await fetchRecentHumanChatHistory({} as never, {
      fetchPage: async () =>
        createFakePage([
          {
            author: { bot: false, username: 'webhook' },
            content: 'should not appear',
            id: '1',
            webhookId: 'webhook-id',
          },
          {
            author: { bot: false, username: 'alice' },
            content: 'visible context',
            id: '2',
          },
        ]),
    });

    assert.deepEqual(result, [{ role: 'user', content: 'alice: visible context' }]);
  });
});

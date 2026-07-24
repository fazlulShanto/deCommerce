import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endGiveaway, startGiveaway } from '../services/giveaway.service';

function failingClient(expectedError: Error) {
  return {
    channels: {
      fetch: async () => {
        throw expectedError;
      },
    },
  } as never;
}

test('scheduled giveaway operations propagate transient Discord failures to the queue runner', async () => {
  const expectedError = new Error('Discord is temporarily unavailable');
  const giveaway = {
    channelId: 'channel',
    messageId: 'message',
  } as never;

  await assert.rejects(startGiveaway(failingClient(expectedError), giveaway), expectedError);
  await assert.rejects(endGiveaway(failingClient(expectedError), giveaway), expectedError);
});

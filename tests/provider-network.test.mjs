import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePortrait } from '../server/provider.mjs';
const input = { guest: Buffer.from('test'), reference: Buffer.from('test'), prompt: 'Golf portrait', model: 'gpt-image-2', size: '1024x1536', quality: 'high', key: 'local-test-only' };
test('blocked network access has an actionable error and never retries', async () => {
  let attempts = 0;
  await assert.rejects(generatePortrait({ ...input, fetchImpl: async () => {
    attempts++; throw new TypeError('fetch failed', { cause: { code: 'EACCES' } });
  } }), /Network access to OpenAI is blocked/);
  assert.equal(attempts, 1);
});
test('ambiguous transport failure keeps billing uncertainty and never retries', async () => {
  let attempts = 0;
  await assert.rejects(generatePortrait({ ...input, fetchImpl: async () => {
    attempts++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  } }), /may have charged/);
  assert.equal(attempts, 1);
});

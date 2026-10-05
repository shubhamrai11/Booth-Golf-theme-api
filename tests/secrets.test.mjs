import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadKey } from '../server/secrets.mjs';
const testRoot = path.resolve('../../work/test-runs');
mkdirSync(testRoot, { recursive: true });
function fixture(t, code) {
  const appRoot = mkdtempSync(path.join(testRoot, 'key-config-'));
  const root = path.join(appRoot, 'data'); mkdirSync(root);
  if (code !== undefined) writeFileSync(path.join(appRoot, 'api-key.local.mjs'), code);
  t.after(() => { if (appRoot.startsWith(testRoot + path.sep)) rmSync(appRoot, { recursive: true, force: true }); });
  return { root, appRoot };
}
test('private code key is loaded from the app folder and takes precedence without modifying state', async t => {
  const { root, appRoot } = fixture(t, 'export const OPENAI_API_KEY = "  local-test-value  ";');
  assert.equal(await loadKey(root, appRoot, { OPENAI_API_KEY: 'environment-test-value' }), 'local-test-value');
});
test('empty or absent local key retains environment and no-key fallback', async t => {
  for (const code of [undefined, 'export const OPENAI_API_KEY = "";']) {
    const { root, appRoot } = fixture(t, code);
    assert.equal(await loadKey(root, appRoot, { OPENAI_API_KEY: 'environment-test-value' }), 'environment-test-value');
    assert.equal(await loadKey(root, appRoot, {}), '');
  }
});
test('invalid private modules fail clearly without revealing their content', async t => {
  for (const code of ['export const OPENAI_API_KEY = 123;', 'export const OPENAI_API_KEY = "private value";', 'throw new Error("PRIVATE_SECRET_SENTINEL");']) {
    const { root, appRoot } = fixture(t, code);
    await assert.rejects(loadKey(root, appRoot, {}), error => {
      assert.match(error.message, /api-key.local.mjs/);
      assert(!error.message.includes('PRIVATE_SECRET_SENTINEL'));
      assert(!error.message.includes('private value'));
      return true;
    });
  }
});

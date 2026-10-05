import path from 'node:path';
import { Booth } from './engine.mjs';
import { createServers } from './http.mjs';
import { loadKey } from './secrets.mjs';
async function main() {
  const appRoot = process.env.FAIRWAY_APP_ROOT || process.cwd();
  const root = process.env.FAIRWAY_DATA_DIR || path.join(appRoot, 'data');
  const booth = new Booth({ root, appRoot });
  booth.key = await loadKey(root, appRoot);
  const servers = createServers(booth);
  const ports = await servers.listen(Number(process.env.FAIRWAY_PORT || 4310), Number(process.env.FAIRWAY_GUEST_PORT || 4311));
  booth.start();
  console.log('Fairway Studio ready at http://127.0.0.1:' + ports.adminPort);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await servers.close(); process.exit(0); });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

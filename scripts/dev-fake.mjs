// 開發用：用模擬 CLI 啟動 AI圓桌會議（不連任何 AI 服務、不用額度）
// node scripts/dev-fake.mjs [port] [資料資料夾] [規則檔]；規則檔內容例如 {"codex":"fail","claude@sum":"quota"}，可在執行中修改
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, '..', 'test', 'fake-cli.mjs');
const [port = '3499', dataDir = path.join(os.tmpdir(), 'rt-dev-data'), rules = path.join(os.tmpdir(), 'rt-rules.json')] = process.argv.slice(2);
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, fake, 'claude'], codex: [process.execPath, fake, 'codex'], agy: [process.execPath, fake, 'gemini'] });
process.env.RT_FAKE_RULES_FILE = rules;
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));   // 開發資料用假的金鑰保護，不碰 DPAPI
require('../app/server.js').main({ port: +port, dataDir, protector: { protect: xor, unprotect: xor } });

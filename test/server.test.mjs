// 本機 API 與資料夾隔離測試（模擬 CLI，不連任何服務）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { resolveInside, workdirFor, listFiles } = require('../app/lib/workspace.js');
const sec = require('../app/lib/security.js');

const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, FAKE, 'claude'], codex: [process.execPath, FAKE, 'codex'], agy: [process.execPath, FAKE, 'gemini'] });
process.env.RT_FAKE_RULES = '{}';
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));
const { main } = require('../app/server.js');

function req(port, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, s => {
      let b = ''; s.on('data', d => b += d); s.on('end', () => res({ status: s.statusCode, headers: s.headers, text: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }));
    });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-srv-'));
  const app = await main({ port: 0, dataDir, open: false, protector: { protect: xor, unprotect: xor }, exitOnQuit: false });
  const page = await req(app.port, '/');
  const token = page.text.match(/name="rt-token" content="([0-9a-f]+)"/)[1];
  const api = (p, body) => req(app.port, p, { method: body ? 'POST' : 'GET', headers: { 'X-RT-Token': token }, body });
  return { ...app, token, api, dataDir };
}

test('workspace paths: traversal, absolute paths and junction escapes are rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ws-'));
  const a = workdirFor(root, 'proj000001', 'chat000001'), b = workdirFor(root, 'proj000001', 'chat000002');
  assert.notEqual(a, b);
  fs.writeFileSync(path.join(b, 'secret.txt'), 'x');
  assert.throws(() => resolveInside(a, '../chat000002/secret.txt'), /不在允許/);
  assert.throws(() => resolveInside(a, 'C:\\Windows\\win.ini'), /不在允許/);
  assert.throws(() => resolveInside(a, path.join(b, 'secret.txt')), /不在允許/);
  assert.throws(() => workdirFor(root, '../evil', 'chat000001'), /代號不正確/);
  fs.symlinkSync(b, path.join(a, 'link'), 'junction');
  assert.throws(() => resolveInside(a, 'link/secret.txt'), /連結/);
  assert.ok(resolveInside(a, 'out/report.md').endsWith(path.join('out', 'report.md')));
  assert.ok(listFiles(a).some(f => f.path === 'link' && f.link), 'links are listed, not followed');
});

test('local API: foreign Host, foreign Origin and missing token are refused; security headers are set', async () => {
  const s = await boot();
  try {
    assert.equal((await req(s.port, '/api/state')).status, 403);
    assert.equal((await req(s.port, '/api/state', { headers: { 'X-RT-Token': 'wrong' } })).status, 403);
    assert.equal((await req(s.port, '/api/state', { headers: { 'X-RT-Token': s.token, Host: 'evil.example:' + s.port } })).status, 403);
    assert.equal((await req(s.port, '/api/settings', { method: 'POST', headers: { 'X-RT-Token': s.token, Origin: 'https://evil.example' }, body: { ais: { claude: { cmd: 'calc' } } } })).status, 403);
    const ok = await s.api('/api/state');
    assert.equal(ok.status, 200);
    assert.match(ok.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(ok.headers['x-frame-options'], 'DENY');
    const ui = await req(s.port, '/ui/js/main.js');
    assert.equal(ui.status, 200);
    const esc = await req(s.port, '/ui/..%2Fserver.js');
    assert.notEqual(esc.text.includes('createServer'), true, 'server source must not be served');
    assert.ok(!(await req(s.port, '/')).text.includes('googleapis'), 'no external fonts');
  } finally { s.quit(); }
});

test('HTTP: unchecked moderator is refused before anything is sent; a normal send completes', async () => {
  const s = await boot();
  try {
    const st = (await s.api('/api/state')).json, pid = st.projects[0].id;
    const cid = (await s.api('/api/chat/new', { pid })).json.id;
    const bad = (await s.api('/api/send', { pid, cid, q: '問題', ids: ['claude', 'gemini'], mod: 'chatgpt', rounds: 1 })).json;
    assert.equal(bad.code, 'moderator');
    await s.api('/api/settings', { ais: { gemini: { ack: true } } });
    const r = (await s.api('/api/send', { pid, cid, q: '問題', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 })).json;
    assert.ok(r.turnId);
    let chat; for (let i = 0; i < 60; i++) { chat = (await s.api(`/api/chat?pid=${pid}&cid=${cid}`)).json; if (!chat.run) break; await new Promise(x => setTimeout(x, 100)); }
    assert.equal(chat.chat.turns.at(-1).status, 'done');
    const files = (await s.api('/api/files/list', { pid, cid })).json;
    assert.ok(files.dir.startsWith(fs.realpathSync(s.dataDir)) || files.dir.startsWith(s.dataDir));
  } finally { s.quit(); }
});

test('settings API only accepts known values; level change clears the acknowledgement', async () => {
  const s = await boot();
  try {
    await s.api('/api/settings', { ais: { gemini: { ack: true } } });
    const v = (await s.api('/api/settings', { ais: { gemini: { level: 'text' }, claude: { level: 'root', mode: 'evil' } }, limits: { maxCalls: 9999 } })).json;
    assert.equal(v.settings.ais.gemini.ack, false);
    assert.equal(v.settings.ais.claude.level, 'web');
    assert.equal(v.settings.ais.claude.mode, 'auto');
    assert.equal(v.settings.limits.maxCalls, 100);
  } finally { s.quit(); }
});

test('single instance: a second start finds the running app; shutdown needs the lock secret', async () => {
  const s = await boot();
  try {
    const again = await main({ port: 0, dataDir: s.dataDir, open: false, protector: { protect: xor, unprotect: xor }, exitOnQuit: false });
    assert.equal(again.alreadyRunning.port, s.port);
    const lock = sec.readLock(path.join(s.dataDir, 'instance.lock'));
    assert.equal((await req(s.port, '/__shutdown', { method: 'POST', headers: { 'X-RT-Secret': 'nope' } })).status, 403);
    assert.equal((await req(s.port, '/__identity')).json.instance, lock.instance);
  } finally { s.quit(); }
});

test('a stale or foreign lock never identifies another program as the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-lock-'));
  const other = http.createServer((q, r) => r.end('{"app":"something-else"}')).listen(0, '127.0.0.1');
  await new Promise(r => other.once('listening', r));
  fs.writeFileSync(path.join(dir, 'instance.lock'), JSON.stringify({ pid: process.pid, port: other.address().port, instance: 'abc', secret: 's' }));
  assert.equal(await sec.findRunning(path.join(dir, 'instance.lock')), null);
  assert.deepEqual(await sec.stopRunning(path.join(dir, 'instance.lock')), { stopped: false, reason: 'none' });
  other.close();
});

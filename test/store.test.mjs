import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openStore, migrate } = require('../app/lib/store.js');
const { resolvePaths } = require('../app/lib/paths.js');
const cs = require('../app/lib/crypto-store.js');

const xor = b => Buffer.from(b.map(x => x ^ 0x5a));
const fakeProtector = { name: 'fake', protect: xor, unprotect: xor };
const failingProtector = { name: 'broken', protect() { throw new Error('no dpapi'); }, unprotect() { throw new Error('no dpapi'); } };
function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-store-'));
  const appDir = path.join(root, 'app'); fs.mkdirSync(appDir);
  return { root, appDir, paths: resolvePaths({ appDir, dataDir: path.join(root, 'data') }) };
}
const LEGACY = {
  settings: { ais: {
    chatgpt: { name: 'ChatGPT', cmd: 'codex --search exec --skip-git-repo-check -s read-only -', role: '' },
    claude: { name: 'Claude', cmd: 'claude -p --max-turns 8 --allowedTools "WebSearch,WebFetch"', role: '審查者', skills: true },
    grok: { name: 'Grok', cmd: '', role: '' },
    gemini: { name: 'Gemini', cmd: 'agy -p {prompt}', role: '' },
    mine: { name: 'Mine', cmd: 'my-ai --flag', role: '' },
  }, setupDone: true },
  projects: [{ id: 'p1', name: '專案', instructions: '說明', memory: '記憶', chats: [{ id: 'c1', title: 't', updated: 1, turns: [
    { q: '問題', ids: ['claude', 'gemini'], mod: 'chatgpt', mode: 'discuss', rounds: 1, status: 'done', summary: 'S', msgs: [
      { round: 1, ai: 'claude', text: 'A', sum: false }, { round: 1, ai: 'gemini', error: '結束碼 1', sum: false }, { round: null, ai: 'chatgpt', text: 'S', sum: true }] },
    { q: '跑到一半', ids: ['claude'], mod: 'claude', rounds: 1, status: 'running', msgs: [] },
  ] }] }],
};

test('v1.0 settings migrate to providers, manual mode, custom command and permission level', () => {
  const { db, from } = migrate(LEGACY);
  assert.equal(from, 1);
  const a = db.settings.ais;
  assert.equal(a.chatgpt.provider, 'codex'); assert.equal(a.chatgpt.mode, 'auto');
  assert.equal(a.claude.level, 'write'); assert.equal(a.claude.role, '審查者');
  assert.equal(a.grok.mode, 'manual');
  assert.equal(a.gemini.provider, 'gemini');
  assert.equal(a.mine.provider, 'custom'); assert.equal(a.mine.cmd, 'my-ai --flag');
  assert.equal(db.settings.setupDone, true);
});

test('v1.0 turns become steps; a "done" turn with a failed AI is partial and an outside moderator is recorded', () => {
  const t = migrate(LEGACY).db.projects[0].chats[0].turns;
  assert.equal(t[0].steps.length, 3);
  assert.equal(t[0].steps[1].status, 'error');
  assert.equal(t[0].status, 'partial');
  assert.equal(t[0].modOutside, true);
  assert.equal(t[1].status, 'interrupted');
});

test('legacy plaintext is imported, encrypted, verified, then renamed (not deleted)', () => {
  const { appDir, paths } = tmp();
  fs.writeFileSync(path.join(appDir, 'data.json'), '﻿' + JSON.stringify(LEGACY));
  const s = openStore(paths, { protector: fakeProtector });
  assert.equal(s.state.encryption, 'on');
  assert.ok(fs.existsSync(paths.encFile));
  assert.ok(!fs.existsSync(paths.plainFile));
  assert.ok(!fs.existsSync(path.join(appDir, 'data.json')));
  assert.ok(fs.existsSync(path.join(appDir, 'data.json.legacy-plaintext')));
  assert.ok(!fs.readFileSync(paths.encFile, 'utf8').includes('記憶'), 'encrypted file must not contain plaintext');
  assert.equal(openStore(paths, { protector: fakeProtector }).db.projects[0].memory, '記憶');
  assert.ok(s.deleteLegacyPlaintext());
  assert.ok(!fs.existsSync(path.join(appDir, 'data.json.legacy-plaintext')));
});

test('unreadable legacy file is left untouched and the app starts empty', () => {
  const { appDir, paths } = tmp();
  fs.writeFileSync(path.join(appDir, 'data.json'), '{broken');
  const s = openStore(paths, { protector: fakeProtector });
  assert.match(s.state.legacyError, /無法讀取/);
  assert.equal(fs.readFileSync(path.join(appDir, 'data.json'), 'utf8'), '{broken');
});

test('encryption failure falls back to plaintext with a visible state and keeps data', () => {
  const { paths } = tmp();
  const s = openStore(paths, { protector: failingProtector });
  assert.equal(s.state.encryption, 'failed');
  assert.match(s.state.encryptionError, /no dpapi/);
  s.db.projects[0].memory = 'x'; s.save();
  assert.equal(JSON.parse(fs.readFileSync(paths.plainFile, 'utf8')).projects[0].memory, 'x');
});

test('an existing encrypted file whose key cannot be unwrapped is never overwritten', () => {
  const { paths } = tmp();
  openStore(paths, { protector: fakeProtector });
  const before = fs.readFileSync(paths.encFile);
  assert.throws(() => openStore(paths, { protector: failingProtector }), /無法解開資料/);
  assert.deepEqual(fs.readFileSync(paths.encFile), before);
});

test('a different key (other Windows account) never moves or overwrites the data file', () => {
  const { paths } = tmp();
  const s = openStore(paths, { protector: fakeProtector }); s.backup('manual');
  const before = fs.readFileSync(paths.encFile);
  const other = b => Buffer.from(b.map(x => x ^ 0x33));
  assert.throws(() => openStore(paths, { protector: { protect: other, unprotect: other } }), e => e.code === 'KEY');
  const wrongKey = { protect: xor, unprotect: () => Buffer.alloc(32, 7) };
  assert.throws(() => openStore(paths, { protector: wrongKey }), e => e.code === 'KEY');
  assert.deepEqual(fs.readFileSync(paths.encFile), before);
  assert.ok(!fs.readdirSync(paths.dataDir).some(n => n.includes('corrupt')));
});

test('corrupt data file is kept aside and the newest good backup is loaded', () => {
  const { paths } = tmp();
  const s = openStore(paths, { protector: fakeProtector });
  s.db.projects[0].memory = '好的備份'; s.save(); s.backup('manual');
  fs.writeFileSync(paths.encFile, 'RTENC1\n{garbage');
  const r = openStore(paths, { protector: fakeProtector });
  assert.equal(r.db.projects[0].memory, '好的備份');
  assert.ok(r.state.recovered.from);
  assert.ok(fs.readdirSync(paths.dataDir).some(n => n.startsWith('data.enc.corrupt-')));
});

test('backups rotate at 20 and restore takes a safety backup first', () => {
  const { paths } = tmp();
  let t = 1000; const s = openStore(paths, { protector: fakeProtector, now: () => (t += 1000) });
  for (let i = 0; i < 25; i++) s.backup('manual');
  assert.equal(s.listBackups().length, 20);
  s.db.projects[0].memory = 'v1'; s.save(); const b = s.backup('manual');
  s.db.projects[0].memory = 'v2'; s.save();
  s.restore(b);
  assert.equal(s.db.projects[0].memory, 'v1');
  assert.ok(s.listBackups().some(x => x.name.includes('before-restore')));
});

test('password export round-trips, rejects a wrong password and import keeps a backup', () => {
  const { paths } = tmp();
  const s = openStore(paths, { protector: fakeProtector });
  s.db.projects[0].memory = '秘密'; s.save();
  const buf = s.exportData({ password: 'pw-123' });
  assert.ok(!buf.toString().includes('秘密'));
  assert.throws(() => cs.exportOpen('wrong', buf), /密碼錯誤/);
  s.db.projects[0].memory = '改掉'; s.save();
  s.importData(buf, { password: 'pw-123' });
  assert.equal(s.db.projects[0].memory, '秘密');
  assert.ok(s.listBackups().some(x => x.name.includes('before-import')));
});

test('retention removes only conversations older than the limit', () => {
  const { paths } = tmp();
  const now = 100 * 86400000;
  const s = openStore(paths, { protector: fakeProtector, now: () => now });
  s.db.projects[0].chats = [{ id: 'old', updated: now - 40 * 86400000, turns: [] }, { id: 'new', updated: now - 5 * 86400000, turns: [] }];
  assert.equal(s.purgeExpired(30), 1);
  assert.deepEqual(s.db.projects[0].chats.map(c => c.id), ['new']);
  assert.equal(s.purgeExpired(0), 0);
});

test('turning encryption off and on rewrites the data file accordingly', () => {
  const { paths } = tmp();
  const s = openStore(paths, { protector: fakeProtector });
  assert.equal(s.setEncryption(false), 'off');
  assert.ok(fs.existsSync(paths.plainFile) && !fs.existsSync(paths.encFile));
  assert.equal(s.setEncryption(true), 'on');
  assert.ok(fs.existsSync(paths.encFile) && !fs.existsSync(paths.plainFile));
});

test('real Windows DPAPI wraps and unwraps the data key', { skip: process.platform !== 'win32' }, () => {
  const p = cs.dpapiProtector(), key = Buffer.from('0123456789abcdef0123456789abcdef');
  const w = p.protect(key);
  assert.notDeepEqual(w, key);
  assert.deepEqual(p.unprotect(w), key);
});

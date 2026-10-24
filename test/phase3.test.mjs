// 第三階段：分工接力、共用資料、成果檔案、版本比較、討論分支（全部用模擬 CLI）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { openStore } = require('../app/lib/store.js');
const { resolvePaths } = require('../app/lib/paths.js');
const { createEngine } = require('../app/lib/engine.js');
const outputs = require('../app/lib/outputs.js');
const { diff } = require('../app/lib/diff.js');
const { branchChat, copyWorkspace } = require('../app/lib/branch.js');
const { workdirFor } = require('../app/lib/workspace.js');

const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, FAKE, 'claude'], codex: [process.execPath, FAKE, 'codex'], agy: [process.execPath, FAKE, 'gemini'] });
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));
let n = 0; const uid = () => 'id' + Date.now().toString(36) + (n++);

function setup(rules = {}) {
  process.env.RT_FAKE_RULES = JSON.stringify(rules);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-p3-'));
  process.env.RT_FAKE_LOG = path.join(root, 'calls.jsonl');
  const paths = resolvePaths({ appDir: root, dataDir: path.join(root, 'data') });
  const store = openStore(paths, { protector: { protect: xor, unprotect: xor } });
  store.db.settings.ais.gemini.ack = true;
  const p = store.db.projects[0]; p.chats.push({ id: 'chat000001', title: '主題', updated: 0, turns: [] });
  const engine = createEngine({ store });
  const calls = () => fs.existsSync(process.env.RT_FAKE_LOG) ? fs.readFileSync(process.env.RT_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { store, engine, p, pid: p.id, cid: 'chat000001', calls, paths, chat: () => p.chats[0], turn: () => p.chats[0].turns.at(-1) };
}
const STAGES = [
  { role: '資料研究', ai: 'claude', task: '查資料', accept: '附來源', input: 'question' },
  { role: '企劃提案', ai: 'chatgpt', task: '提方案', accept: '可執行', input: 'previous' },
  { role: '風險審查', ai: 'claude', task: '找風險', accept: '列等級', input: 'all' },
];

test('relay: stages run in order, each gets only its hand-off, review pauses, revise reruns one stage with feedback', async () => {
  const s = setup();
  const go = (action, note) => s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, action, note }).done;
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '週年慶怎麼辦', mode: 'relay', stages: STAGES }).done;
  assert.equal(s.turn().status, 'waiting'); assert.equal(s.turn().waitingAfter, 1);
  assert.equal(s.calls().length, 1);
  const c1 = s.calls()[0];
  assert.match(c1.stdin, /你負責「資料研究」[\s\S]*驗收條件：附來源/); assert.ok(!c1.stdin.includes('前面棒次的產出'));
  await go('continue');
  const c2 = s.calls()[1];
  assert.equal(c2.provider, 'codex');
  assert.match(c2.stdin, /【前面棒次的產出】[\s\S]*<<<參考資料開始>>>\n【第 1 棒：資料研究（Claude）】\nclaude 第S1輪的回答/);
  await go('revise', '預算要壓在五萬內');
  const c2b = s.calls()[2];
  assert.equal(c2b.round, 'S2');
  assert.match(c2b.stdin, /【退回修改】[\s\S]*預算要壓在五萬內[\s\S]*你上一版的產出：\ncodex 第S2輪的回答/);
  assert.equal(s.turn().waitingAfter, 2, 'revised stage is reviewed again before moving on');
  await go('continue');
  const c3 = s.calls()[3];
  assert.match(c3.stdin, /第 1 棒：資料研究[\s\S]*第 2 棒：企劃提案/, 'input "all" receives every earlier stage');
  assert.ok(!s.turn().notes.some(x => x.text.includes('五萬')), 'revision feedback goes only to that stage');
  assert.equal(s.turn().status, 'done');
  assert.equal(s.turn().summary, 'claude 第S3輪的回答');
  assert.equal(s.turn().steps.filter(x => x.round === 2).length, 2, 'the earlier version is kept as history');
});

test('relay: a failed stage stops the chain; retrying that stage continues from it', async () => {
  const s = setup({ 'codex@S2': 'fail' });
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', mode: 'relay', stages: STAGES, review: false }).done;
  assert.equal(s.turn().status, 'waiting');
  assert.equal(s.turn().reasons[0].code, 'stage_failed');
  assert.ok(!s.calls().some(c => c.round === 'S3'), 'later stages are not run after a failure');
  process.env.RT_FAKE_RULES = '{}';
  const failed = s.turn().steps.find(x => x.round === 2 && x.status === 'error');
  await s.engine.retry({ pid: s.pid, cid: s.cid, turnId: s.turn().id, stepIds: [failed.id] }).done;
  assert.equal(s.turn().status, 'done');
  assert.deepEqual(s.calls().map(c => c.round), ['S1', 'S2', 'S2', 'S3']);
});

test('shared materials reach only the AIs they are shared with; only all-shared files go into the work folder', async () => {
  const s = setup();
  s.p.materials = [
    { id: 'm1', kind: 'text', title: '公開資料', text: '大家都能看的內容', share: 'all', auto: true },
    { id: 'm2', kind: 'file', title: '報價單', fileName: 'quote.txt', text: '機密報價 12345', share: ['claude'], auto: true },
    { id: 'm3', kind: 'file', title: '說明書', fileName: 'manual.txt', text: '使用說明', share: 'all', auto: true },
    { id: 'm4', kind: 'text', title: '沒選的', text: '這次不附上', share: 'all', auto: false },
  ];
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  const cl = s.calls().find(c => c.provider === 'claude' && c.round === '1'), ge = s.calls().find(c => c.provider === 'gemini');
  assert.ok(cl.stdin.includes('機密報價 12345') && cl.stdin.includes('大家都能看的內容'));
  assert.ok(!ge.stdin.includes('機密報價') && ge.stdin.includes('大家都能看的內容'));
  assert.ok(!cl.stdin.includes('這次不附上'));
  const wd = workdirFor(s.paths.workRoot, s.pid, s.cid);
  assert.ok(fs.existsSync(path.join(wd, 'materials', 'manual.txt')));
  assert.ok(!fs.existsSync(path.join(wd, 'materials', 'quote.txt')), 'a file shared with only some AIs is not placed where every AI can read it');
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'y', ids: ['claude'], materials: ['m4'] }).done;
  assert.ok(s.calls().at(-1).stdin.includes('這次不附上') && !s.calls().at(-1).stdin.includes('大家都能看的內容'), 'per-question selection overrides defaults');
});

test('output template is added to the final step only', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1, outputTemplate: 'budget' }).done;
  assert.ok(s.calls().filter(c => c.round === '1').every(c => !c.stdin.includes('【成果格式')));
  assert.match(s.calls().find(c => c.round === 'sum').stdin, /【成果格式：預算比較】/);
});

test('outputs: versions never overwrite, CSV from a table, HTML is escaped, file panel knows the source', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-out-')), chat = { turns: [{ id: 't1', steps: [{ id: 's1', ai: 'claude', events: [{ kind: 'write', path: path.join(wd, 'draft.md') }] }] }] };
  fs.writeFileSync(path.join(wd, 'draft.md'), 'AI 寫的');
  const text = '# 預算\n| 方案 | 費用 |\n|---|---|\n| A, 套裝 | 100 |\n<script>x</script>';
  const v1 = outputs.saveOutput({ workdir: wd, chat, name: '預算 比較', format: 'md', text, from: { turnId: 't1', ai: 'claude' } });
  const v2 = outputs.saveOutput({ workdir: wd, chat, name: '預算 比較', format: 'md', text: text + '\n更新' });
  assert.equal(v1.path, 'outputs/預算-比較-v1.md'); assert.equal(v2.version, 2);
  assert.ok(fs.existsSync(path.join(wd, 'outputs', '預算-比較-v1.md')));
  const csv = outputs.saveOutput({ workdir: wd, chat, name: '預算', format: 'csv', text });
  assert.equal(fs.readFileSync(path.join(wd, csv.path), 'utf8'), '﻿方案,費用\r\n"A, 套裝",100\r\n');
  assert.throws(() => outputs.saveOutput({ workdir: wd, chat, name: 'x', format: 'csv', text: '沒有表格' }), /沒有表格/);
  const html = fs.readFileSync(path.join(wd, outputs.saveOutput({ workdir: wd, chat, name: '頁', format: 'html', text }).path), 'utf8');
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>x'));
  assert.throws(() => outputs.saveOutput({ workdir: wd, chat, name: 'x', format: 'docx', text }), /不支援/);
  const idx = outputs.fileIndex(wd, chat);
  assert.equal(idx.find(f => f.path === 'outputs/預算-比較-v2.md').output.version, 2);
  assert.equal(idx.find(f => f.path === 'draft.md').writtenBy.ai, 'claude');
  assert.equal(outputs.readFile(wd, 'outputs/預算-比較-v1.md').text, text);
  assert.throws(() => outputs.readFile(wd, '../x.md'), /不在允許/);
});

test('diff marks added and removed lines', () => {
  const d = diff('甲\n乙\n丙', '甲\n丙\n丁');
  assert.deepEqual(d.ops.map(o => o.type + o.text), ['eq甲', 'del乙', 'eq丙', 'add丁']);
  assert.equal(d.added, 1); assert.equal(d.removed, 1);
});

test('branch: copies background up to a round, drops later work, and both branches stay independent', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '主題', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2 }).done;
  const parent = s.chat(), t = s.turn();
  outputs.saveOutput({ workdir: workdirFor(s.paths.workRoot, s.pid, s.cid), chat: parent, name: '草稿', text: '共同背景' });
  const b = branchChat({ project: s.p, chat: parent, turnId: t.id, round: 1, title: '方案 A', uid });
  copyWorkspace(workdirFor(s.paths.workRoot, s.pid, s.cid), workdirFor(s.paths.workRoot, s.pid, b.id));
  const bt = b.turns.at(-1);
  assert.equal(bt.rounds, 1); assert.ok(bt.steps.every(x => x.kind === 'answer' && x.round === 1));
  assert.equal(b.branchOf.cid, s.cid); assert.equal(b.branchOf.round, 1);
  assert.ok(fs.existsSync(path.join(workdirFor(s.paths.workRoot, s.pid, b.id), 'outputs', '草稿-v1.md')));
  const before = JSON.stringify(parent.turns);
  await s.engine.more({ pid: s.pid, cid: b.id, turnId: bt.id }).done;
  assert.equal(JSON.stringify(parent.turns), before, 'continuing the branch does not touch the original');
  assert.equal(b.turns.at(-1).status, 'done');
  assert.ok(!bt.steps.some(x => parent.turns.at(-1).steps.some(y => y.id === x.id)), 'branch steps have their own ids');
});

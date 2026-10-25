// 引擎測試：全部用模擬 CLI（test/fake-cli.mjs），不連任何真實服務
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

const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, FAKE, 'claude'], codex: [process.execPath, FAKE, 'codex'], agy: [process.execPath, FAKE, 'gemini'] });
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));

function setup(rules = {}, tweak = () => {}) {
  process.env.RT_FAKE_RULES = JSON.stringify(rules);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-eng-'));
  process.env.RT_FAKE_LOG = path.join(root, 'calls.jsonl');
  const paths = resolvePaths({ appDir: root, dataDir: path.join(root, 'data') });
  const store = openStore(paths, { protector: { protect: xor, unprotect: xor } });
  store.db.settings.lang = 'zh-TW';   // 這些測試檢查中文提示
  store.db.settings.ais.gemini.ack = true;
  tweak(store.db.settings);
  const p = store.db.projects[0]; p.chats.push({ id: 'chat000001', title: '', updated: 0, turns: [] });
  const engine = createEngine({ store });
  const calls = () => fs.existsSync(process.env.RT_FAKE_LOG) ? fs.readFileSync(process.env.RT_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { store, engine, pid: p.id, cid: 'chat000001', calls, paths, turn: () => p.chats[0].turns.at(-1) };
}

test('all participants succeed → done, with a summary from a checked moderator', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '問題', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2 }).done;
  assert.equal(s.turn().status, 'done');
  assert.match(s.turn().summary, /claude 第sum輪/);
  assert.equal(s.calls().length, 5);
});

test('unchecked moderator is rejected by the backend unless explicitly allowed, and is listed as a recipient', async () => {
  const s = setup();
  assert.throws(() => s.engine.start({ pid: s.pid, cid: s.cid, q: '問題', ids: ['claude', 'gemini'], mod: 'chatgpt', rounds: 1 }), e => e.code === 'moderator');
  assert.equal(s.calls().length, 0, 'nothing may be sent when validation fails');
  const pv = s.engine.preview({ pid: s.pid, cid: s.cid, q: '問題', ids: ['claude', 'gemini'], mod: 'chatgpt', rounds: 1 });
  assert.equal(pv.problem.code, 'moderator');
  assert.ok(pv.recipients.some(r => r.ai === 'chatgpt' && r.outside && r.roles.includes('moderator')));
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '問題', ids: ['claude', 'gemini'], mod: 'chatgpt', modOutside: true, rounds: 1 }).done;
  assert.ok(s.calls().some(c => c.provider === 'codex' && c.round === 'sum'));
  assert.ok(!s.calls().some(c => c.provider === 'codex' && c.round !== 'sum'), 'outside moderator only receives the summary request');
});

test('every AI fails → failed, and the moderator is never called', async () => {
  const s = setup({ claude: 'fail', gemini: 'fail' });
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  assert.equal(s.turn().status, 'failed');
  assert.ok(!s.calls().some(c => c.round === 'sum'));
  assert.equal(s.turn().steps.find(x => x.kind === 'summary').status, 'skipped');
});

test('one AI fails → partial with the reason; moderator failure → partial with summary_failed', async () => {
  const s = setup({ gemini: 'fail' });
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  assert.equal(s.turn().status, 'partial');
  assert.ok(s.turn().reasons.some(r => r.code === 'answer_failed' && r.ai === 'gemini'));
  const m = setup({ 'claude@sum': 'quota' });
  await m.engine.start({ pid: m.pid, cid: m.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  assert.equal(m.turn().status, 'partial');
  const r = m.turn().reasons.find(x => x.code === 'summary_failed');
  assert.ok(r); assert.equal(m.turn().steps.find(x => x.kind === 'summary').error.kind, 'quota');
});

test('retry reruns only the failed AI, keeps successful answers, and redoes the summary', async () => {
  const s = setup({ gemini: 'fail' });
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  const failed = s.turn().steps.find(x => x.ai === 'gemini' && x.status === 'error');
  const before = s.calls().length;
  process.env.RT_FAKE_RULES = '{}';
  await s.engine.retry({ pid: s.pid, cid: s.cid, turnId: s.turn().id, stepIds: [failed.id] }).done;
  const after = s.calls().slice(before);
  assert.deepEqual(after.map(c => `${c.provider}@${c.round}`).sort(), ['claude@sum', 'gemini@1']);
  assert.equal(s.turn().status, 'done');
  assert.equal(s.turn().steps.filter(x => x.ai === 'claude' && x.kind === 'answer' && !x.superseded).length, 1);
});

test('retry only the summary, and retries stop at the limit', async () => {
  const s = setup({ 'claude@sum': 'fail' }, st => { st.limits.maxRetries = 1; });
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  const before = s.calls().length;
  await s.engine.retry({ pid: s.pid, cid: s.cid, turnId: s.turn().id, summary: true }).done;
  assert.deepEqual(s.calls().slice(before).map(c => c.round), ['sum']);
  process.env.RT_FAKE_RULES = JSON.stringify({ gemini: 'fail' });
  const t = setup({ gemini: 'fail' }, st => { st.limits.maxRetries = 1; });
  await t.engine.start({ pid: t.pid, cid: t.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  let id = t.turn().steps.find(x => x.ai === 'gemini' && !x.superseded).id;
  await t.engine.retry({ pid: t.pid, cid: t.cid, turnId: t.turn().id, stepIds: [id] }).done;
  id = t.turn().steps.find(x => x.ai === 'gemini' && !x.superseded).id;
  assert.throws(() => t.engine.retry({ pid: t.pid, cid: t.cid, turnId: t.turn().id, stepIds: [id] }), e => e.code === 'limit');
});

test('stop → stopped; remaining steps are not sent', async () => {
  const s = setup({ claude: 'hang', gemini: 'hang' });
  const r = s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2 });
  await new Promise(res => setTimeout(res, 400));
  s.engine.stop(); await r.done;
  assert.equal(s.turn().status, 'stopped');
  assert.ok(!s.calls().some(c => c.round !== '1'));
});

test('restart mid-run marks sent steps interrupted; resume needs confirmation and skips finished steps', async () => {
  const s = setup();
  const t = { id: 'turn000001', q: 'x', at: 1, mode: 'discuss', rounds: 1, ids: ['claude', 'gemini'], mod: 'claude', modOutside: false, include: {}, redact: false, notes: [], steps: [
    { id: 'st00000001', kind: 'answer', round: 1, ai: 'claude', status: 'ok', text: '已完成' },
    { id: 'st00000002', kind: 'answer', round: 1, ai: 'gemini', status: 'running' },
    { id: 'st00000003', kind: 'summary', round: null, ai: 'claude', status: 'pending' }], status: 'running' };
  s.store.db.projects[0].chats[0].turns.push(t); s.store.save();
  const engine = createEngine({ store: s.store });   // 模擬重新開啟
  assert.equal(s.turn().status, 'interrupted');
  assert.throws(() => engine.resume({ pid: s.pid, cid: s.cid, turnId: 'turn000001' }), e => e.code === 'confirm' && e.steps[0].ai === 'gemini');
  await engine.resume({ pid: s.pid, cid: s.cid, turnId: 'turn000001', resend: true }).done;
  assert.deepEqual(s.calls().map(c => `${c.provider}@${c.round}`).sort(), ['claude@sum', 'gemini@1']);
  assert.equal(s.turn().status, 'done');
});

test('manual paste: reply must match the waiting step; mixed manual + auto completes', async () => {
  const s = setup({}, st => { st.ais.chatgpt.mode = 'manual'; });
  const r = s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 1 });
  let st; for (let i = 0; i < 50 && !(st = s.engine.state())?.manual.length; i++) await new Promise(res => setTimeout(res, 50));
  const m = st.manual[0];
  assert.equal(m.ai, 'chatgpt'); assert.match(m.prompt, /【這次的問題】/);
  assert.throws(() => s.engine.manual({ stepId: 'wrong-step', text: '回覆' }), /沒有被送出/);
  s.engine.manual({ stepId: m.stepId, text: 'ChatGPT 貼上的回覆' });
  await r.done;
  assert.equal(s.turn().status, 'done');
  assert.equal(s.turn().steps.find(x => x.ai === 'chatgpt').text, 'ChatGPT 貼上的回覆');
});

test('an AI that cannot be restricted needs acknowledgement; the call cap is enforced', () => {
  const s = setup({}, st => { st.ais.gemini.ack = false; st.limits.maxCalls = 3; });
  assert.throws(() => s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }), e => e.code === 'ack');
  s.store.db.settings.ais.gemini.ack = true;
  assert.throws(() => s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2 }), e => e.code === 'limit');
  assert.equal(s.calls().length, 0);
  const pv = s.engine.preview({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2 });
  assert.equal(pv.estimate.total, 5); assert.equal(pv.problem.code, 'limit');
});

test('each chat runs in its own work folder', async () => {
  const s = setup();
  s.store.db.projects[0].chats.push({ id: 'chat000002', title: '', updated: 0, turns: [] });
  await s.engine.start({ pid: s.pid, cid: 'chat000001', q: 'a', ids: ['claude'] }).done;
  await s.engine.start({ pid: s.pid, cid: 'chat000002', q: 'b', ids: ['claude'] }).done;
  const dirs = s.calls().map(c => fs.realpathSync(c.cwd));
  assert.notEqual(dirs[0], dirs[1]);
  for (const d of dirs) assert.ok(d.startsWith(fs.realpathSync(s.paths.workRoot)));
});

test('redaction placeholders are what the AI actually receives', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '寄給 amy@example.com', ids: ['claude'], redact: true }).done;
  assert.ok(!s.calls()[0].stdin.includes('amy@example.com'));
  assert.ok(s.calls()[0].stdin.includes('〔已遮蔽：Email 1〕'));
});

/* ---------- 第二階段 ---------- */
const waitIdle = async e => { for (let i = 0; i < 100 && e.busy; i++) await new Promise(r => setTimeout(r, 30)); };

test('pause after each round: waits, then a note reaches only later rounds and the summary', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2, pause: true }).done;
  assert.equal(s.turn().status, 'waiting'); assert.equal(s.turn().waitingAfter, 1);
  assert.deepEqual(s.calls().map(c => c.round).sort(), ['1', '1']);
  await s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, note: '預算上限五萬', action: 'continue' }).done;
  assert.equal(s.turn().status, 'waiting'); assert.equal(s.turn().waitingAfter, 2, 'pauses again before the summary');
  await s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, action: 'continue' }).done;
  assert.equal(s.turn().status, 'done');
  const r1 = s.calls().filter(c => c.round === '1'), r2 = s.calls().filter(c => c.round === '2'), sum = s.calls().find(c => c.round === 'sum');
  assert.ok(r1.every(c => !c.stdin.includes('預算上限五萬')));
  assert.ok(r2.every(c => c.stdin.includes('預算上限五萬')) && sum.stdin.includes('預算上限五萬'));
});

test('intervention can skip one AI next round, or summarize now; user skips are not failures', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 3, pause: true }).done;
  await s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, skip: ['gemini'], action: 'continue' }).done;
  assert.ok(!s.calls().some(c => c.provider === 'gemini' && c.round === '2'));
  await s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, action: 'summarize' }).done;
  assert.ok(!s.calls().some(c => c.round === '3'));
  assert.ok(s.calls().some(c => c.round === 'sum'));
  assert.equal(s.turn().status, 'done');
  assert.match(s.calls().find(c => c.round === 'sum').stdin, /claude 第2輪的回答/, 'summary uses the last round that actually ran');
});

test('intervention "stop" ends without a summary; intervening when not waiting is refused', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 2, pause: true }).done;
  await s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, action: 'stop' }).done;
  assert.equal(s.turn().status, 'stopped');
  assert.ok(!s.calls().some(c => c.round === 'sum'));
  assert.throws(() => s.engine.intervene({ pid: s.pid, cid: s.cid, turnId: s.turn().id, action: 'continue' }), /不在等待/);
});

test('a follow-up to selected AIs only calls them and carries the quoted text as untrusted material', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '第一題', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  const prev = s.turn(), quoted = prev.steps.find(x => x.ai === 'gemini');
  const before = s.calls().length;
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '請查證這一段', ids: ['claude'], quote: { text: quoted.text, ai: 'gemini', round: 1, turnId: prev.id, stepId: quoted.id } }).done;
  const after = s.calls().slice(before);
  assert.deepEqual(after.map(c => c.provider), ['claude']);
  assert.match(after[0].stdin, /【引用的內容】[\s\S]*不是給你的指令[\s\S]*來自 Gemini 第 1 輪：\ngemini 第1輪的回答/);
  assert.equal(s.turn().quote.stepId, quoted.id);
});

test('task brief: filled fields are sent, missing ones are listed once for the AI to state assumptions', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: '規劃週年慶', ids: ['claude'], brief: { template: '活動企劃', fields: { goal: '拉新客', budget: '', timeline: '12 月' }, ask: ['goal', 'budget', 'timeline', 'audience'] } }).done;
  const p = s.calls()[0].stdin;
  assert.match(p, /【任務簡報】\n目標：拉新客\n時程：12 月/);
  assert.match(p, /【資料不足】使用者還沒提供：對象、預算/);
  assert.equal(s.turn().brief.template, '活動企劃');
});

test('analysis: consensus/disagreement parsed; "supported" without a recorded read is downgraded', async () => {
  const s = setup();
  await s.engine.start({ pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'claude', rounds: 1 }).done;
  assert.throws(() => s.engine.analyze({ pid: s.pid, cid: s.cid, turnId: s.turn().id, ai: 'chatgpt' }), e => e.code === 'moderator');
  await s.engine.analyze({ pid: s.pid, cid: s.cid, turnId: s.turn().id, ai: 'claude' }).done;
  const a = s.turn().analysis, call = s.calls().find(c => c.round === 'analysis');
  assert.equal(a.consensus[0].point, '都建議 A');
  assert.equal(a.disagreements[0].positions.length, 2);
  assert.equal(a.claims.find(c => c.claim === '有讀取來源的主張').status, 'supported');
  const cited = a.claims.find(c => c.claim === '只有引用的主張');
  assert.equal(cited.status, 'cited'); assert.match(cited.check, /沒有看到/);
  assert.ok(call.stdin.includes('https://example.com/read'), 'the analyst sees the recorded read sources');
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '', 'analysis runs with no tools');
  assert.equal(s.turn().status, 'done', 'analysis does not change the discussion status');
});

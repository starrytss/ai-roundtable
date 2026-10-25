// 第四階段：圖片、模型與席位、搜尋標籤收藏、任務佇列、匿名比較、收斂與時間上限（模擬 CLI）
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
const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, FAKE, 'claude'], codex: [process.execPath, FAKE, 'codex'], agy: [process.execPath, FAKE, 'gemini'] });
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));
const { main } = require('../app/server.js');
const { buildPayload } = require('../app/lib/context.js');
const { workdirFor } = require('../app/lib/workspace.js');
const RED = fs.readFileSync(path.join(here, 'fixtures', 'red.png')).toString('base64');

function req(port, p, body, token) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', headers: { Host: `127.0.0.1:${port}`, 'X-RT-Token': token } }, s => {
      let b = ''; s.on('data', d => b += d); s.on('end', () => { try { res(JSON.parse(b)); } catch { res(b); } });
    });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function boot(rules = {}) {
  process.env.RT_FAKE_RULES = JSON.stringify(rules);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-p4-'));
  process.env.RT_FAKE_LOG = path.join(dataDir, 'calls.jsonl');
  const app = await main({ port: 0, dataDir, open: false, protector: { protect: xor, unprotect: xor }, exitOnQuit: false });
  const page = await new Promise(r => http.get({ host: '127.0.0.1', port: app.port, path: '/', headers: { Host: `127.0.0.1:${app.port}` } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r(b)); }));
  const token = page.match(/rt-token" content="([0-9a-f]+)/)[1];
  const api = (p, body) => req(app.port, p, body, token);
  await api('/api/settings', { lang: 'zh-TW', ais: { gemini: { ack: true } } });   // 這些測試檢查中文提示
  const pid = (await api('/api/state')).projects[0].id, cid = (await api('/api/chat/new', { pid })).id;
  const calls = () => fs.existsSync(process.env.RT_FAKE_LOG) ? fs.readFileSync(process.env.RT_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const waitIdle = async () => { for (let i = 0; i < 150; i++) { const c = await api(`/api/chat?pid=${pid}&cid=${cid}`); if (!c.run && !(await api('/api/state')).queue.some(q => ['queued', 'running'].includes(q.status))) return c; await new Promise(r => setTimeout(r, 80)); } };
  return { ...app, api, pid, cid, calls, waitIdle, dataDir };
}

test('images: type is checked by content; each AI gets them the way it can actually see them', async () => {
  const s = await boot();
  try {
    assert.match((await s.api('/api/attachments/add', { pid: s.pid, cid: s.cid, name: 'x.png', mime: 'image/png', data: Buffer.from('not an image').toString('base64') })).error, /不是宣稱的圖片格式/);
    assert.match((await s.api('/api/attachments/add', { pid: s.pid, cid: s.cid, name: 'x.svg', mime: 'image/svg+xml', data: RED })).error, /只接受/);
    const a = (await s.api('/api/attachments/add', { pid: s.pid, cid: s.cid, name: '設計稿.png', mime: 'image/png', data: RED })).attachment;
    assert.ok(a.id && !a.path, 'the absolute path is not sent to the page');
    const pv = await s.api('/api/preview', { pid: s.pid, cid: s.cid, q: '評論這張設計稿', ids: ['claude', 'chatgpt', 'gemini'], mod: 'claude', rounds: 1, images: [a.id] });
    assert.deepEqual(Object.fromEntries(pv.recipients.map(r => [r.ai, r.image])), { claude: 'direct', chatgpt: 'direct', gemini: 'tool' });
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: '評論這張設計稿', ids: ['claude', 'chatgpt', 'gemini'], mod: 'claude', rounds: 1, images: [a.id] });
    await s.waitIdle();
    const c = s.calls(), cl = c.find(x => x.provider === 'claude' && x.round === '1'), cx = c.find(x => x.provider === 'codex'), ge = c.find(x => x.provider === 'gemini');
    assert.ok(cl.args.includes('--input-format') && cl.stdin.includes('"type":"image"') && cl.stdin.includes('"media_type":"image/png"'));
    assert.ok(cx.args.some(x => x.startsWith('--image=') && x.endsWith('.png')));
    assert.match(ge.stdin, /放在工作資料夾 attachments\/[\s\S]*不要猜測圖片內容/);
    assert.ok(fs.existsSync(path.join(workdirFor(path.join(s.dataDir, 'workspaces'), s.pid, s.cid), 'attachments', a.id + '.png')));
  } finally { s.quit(); }
});

test('an AI that cannot see images is told so instead of being left to guess', () => {
  const p = buildPayload({ project: {}, chat: { turns: [] }, turn: { id: 't', q: 'x', ids: ['grok'], rounds: 1, steps: [], images: [{ name: 'a.png', file: 'a.png' }] }, ai: { provider: 'grok', mode: 'auto', level: 'web' }, aiId: 'grok', round: 1 });
  assert.match(p.prompt, /你看不到圖片內容。不要假設或猜測/);
  const m = buildPayload({ project: {}, chat: { turns: [] }, turn: { id: 't', q: 'x', ids: ['grok'], rounds: 1, steps: [], images: [{ name: 'a.png', file: 'a.png' }] }, ai: { provider: 'grok', mode: 'manual' }, aiId: 'grok', round: 1 });
  assert.match(m.prompt, /請使用者把圖片一起上傳到網站/);
});

test('models and seats: same provider can sit twice with its own model and role; built-ins cannot be deleted', async () => {
  const s = await boot();
  try {
    assert.ok((await s.api('/api/models', { id: 'claude' })).models.some(m => m.id === 'sonnet'));
    const st = await s.api('/api/ais/add', { provider: 'claude', name: 'Claude 審查員', model: 'sonnet', role: '專找漏洞' });
    const seat = Object.entries(st.settings.ais).find(([, a]) => a.name === 'Claude 審查員');
    assert.ok(seat && seat[1].seat && seat[1].caps.image === 'direct');
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', seat[0]], mod: 'claude', rounds: 1 });
    await s.waitIdle();
    const cl = s.calls().filter(c => c.provider === 'claude' && c.round === '1');
    assert.equal(cl.length, 2);
    assert.ok(cl.some(c => c.args.includes('sonnet') && c.stdin.includes('專找漏洞')));
    assert.match((await s.api('/api/ais/delete', { id: 'claude' })).error, /不能刪除/);
    assert.ok(!Object.keys((await s.api('/api/ais/delete', { id: seat[0] })).settings.ais).includes(seat[0]));
  } finally { s.quit(); }
});

test('search, tags and favorites work across projects and stay local', async () => {
  const s = await boot();
  try {
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: '週年慶 活動', ids: ['claude'] }); await s.waitIdle();
    const chat = (await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat, step = chat.turns[0].steps[0];
    await s.api('/api/chat/tags', { pid: s.pid, cid: s.cid, tags: ['#行銷', '行銷', '  '] });
    assert.deepEqual((await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat.tags, ['行銷']);
    await s.api('/api/step/favorite', { pid: s.pid, cid: s.cid, turnId: chat.turns[0].id, stepId: step.id, on: true });
    const pid2 = (await s.api('/api/project/new', { name: '另一個專案' })).id, cid2 = (await s.api('/api/chat/new', { pid: pid2 })).id;
    await s.api('/api/send', { pid: pid2, cid: cid2, q: '供應商比較', ids: ['chatgpt'] }); await s.waitIdle();
    assert.ok((await s.api('/api/search', { q: '週年慶' })).results.some(r => r.kind === 'question' && r.cid === s.cid));
    assert.ok((await s.api('/api/search', { q: '第1輪' })).results.some(r => r.pid === pid2), 'searches every project');
    assert.deepEqual((await s.api('/api/search', { q: '第1輪', ai: 'chatgpt' })).results.map(r => r.ai), ['chatgpt']);
    assert.deepEqual((await s.api('/api/search', { tag: '行銷', q: '回答' })).results.map(r => r.cid), [s.cid]);
    assert.deepEqual((await s.api('/api/search', { fav: true })).results.map(r => r.stepId), [step.id]);
    assert.equal((await s.api('/api/search', { q: '第1輪', to: 1 })).results.length, 0, 'date filter');
  } finally { s.quit(); }
});

test('queue runs tasks one after another, keeps each result in its own chat, and can cancel', async () => {
  const s = await boot({ claude: 'slow' });
  try {
    const cid2 = (await s.api('/api/chat/new', { pid: s.pid })).id, cid3 = (await s.api('/api/chat/new', { pid: s.pid })).id;
    await s.api('/api/queue/add', { pid: s.pid, cid: s.cid, q: '任務一', ids: ['claude'] });
    await s.api('/api/queue/add', { pid: s.pid, cid: cid2, q: '任務二', ids: ['claude'] });
    await s.api('/api/queue/add', { pid: s.pid, cid: cid3, q: '任務三', ids: ['claude'] });
    const third = (await s.api('/api/state')).queue.find(q => q.q === '任務三');
    await s.api('/api/queue/cancel', { id: third.id });
    assert.match((await s.api('/api/queue/add', { pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'gemini'], mod: 'chatgpt', rounds: 1 })).error, /主持人/);
    await s.waitIdle();
    const q = (await s.api('/api/state')).queue;
    assert.deepEqual(q.map(x => `${x.q}:${x.status}`), ['任務一:finished', '任務二:finished', '任務三:canceled']);
    const c = s.calls().map(x => x.stdin.includes('任務一') ? 1 : x.stdin.includes('任務二') ? 2 : 0);
    assert.deepEqual(c, [1, 2], 'one at a time, in order');
    assert.equal((await s.api(`/api/chat?pid=${s.pid}&cid=${cid2}`)).chat.turns[0].q, '任務二');
    assert.equal((await s.api(`/api/chat?pid=${s.pid}&cid=${cid3}`)).chat.turns.length, 0);
  } finally { s.quit(); }
});

test('anonymous comparison records only personal preference per task type', async () => {
  const s = await boot();
  try {
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 1 }); await s.waitIdle();
    const t = (await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat.turns[0], win = t.steps.find(x => x.ai === 'chatgpt' && x.kind === 'answer');
    const r = await s.api('/api/prefs/vote', { pid: s.pid, cid: s.cid, turnId: t.id, round: 1, stepId: win.id, task: '行銷' });
    assert.deepEqual(r.stats.byTask['行銷'], { chatgpt: { seen: 1, chosen: 1 }, claude: { seen: 1, chosen: 0 } });
    assert.equal((await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat.turns[0].votes['1'], win.id);
  } finally { s.quit(); }
});

test('low-novelty rounds raise a hint; the time limit stops the discussion with its reason', async () => {
  const s = await boot({ claude: 'same', codex: 'same' });
  try {
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'x', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 2 }); await s.waitIdle();
    const t = (await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat.turns[0];
    assert.ok(t.hints.some(h => h.code === 'low_novelty' && h.round === 2));
    assert.ok(t.steps.filter(x => x.round === 2).every(x => typeof x.novelty === 'number'));
    s.store.db.settings.limits.maxMinutes = 0.005;   // 約 0.3 秒
    process.env.RT_FAKE_RULES = JSON.stringify({ claude: 'hang' });
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'y', ids: ['claude'] }); await s.waitIdle();
    const t2 = (await s.api(`/api/chat?pid=${s.pid}&cid=${s.cid}`)).chat.turns.at(-1);
    assert.equal(t2.status, 'stopped'); assert.equal(t2.reasons[0].code, 'time_limit');
  } finally { s.quit(); }
});

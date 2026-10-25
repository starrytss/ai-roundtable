// 介面語言：新安裝預設英文、舊資料維持中文、英文時送給 AI 的提示與內建範本都是英文、介面對照表格式正確（模擬 CLI）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify({ claude: [process.execPath, FAKE, 'claude'], codex: [process.execPath, FAKE, 'codex'], agy: [process.execPath, FAKE, 'gemini'] });
const xor = b => Buffer.from(b.map(x => x ^ 0x5a));
const { main } = require('../app/server.js');
const { buildPayload } = require('../app/lib/context.js');
const { migrate, emptyDb } = require('../app/lib/store.js');
const CJK = /[㐀-鿿]/;

function req(port, p, body, token) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', headers: { Host: `127.0.0.1:${port}`, 'X-RT-Token': token } }, s => {
      let b = ''; s.on('data', d => b += d); s.on('end', () => { try { res(JSON.parse(b)); } catch { res(b); } });
    });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function boot() {
  process.env.RT_FAKE_RULES = '{}';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-i18n-'));
  process.env.RT_FAKE_LOG = path.join(dataDir, 'calls.jsonl');
  const app = await main({ port: 0, dataDir, open: false, protector: { protect: xor, unprotect: xor }, exitOnQuit: false });
  const page = await new Promise(r => http.get({ host: '127.0.0.1', port: app.port, path: '/', headers: { Host: `127.0.0.1:${app.port}` } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r(b)); }));
  const token = page.match(/rt-token" content="([0-9a-f]+)/)[1];
  const api = (p, body) => req(app.port, p, body, token);
  const pid = (await api('/api/state')).projects[0].id, cid = (await api('/api/chat/new', { pid })).id;
  const calls = () => fs.existsSync(process.env.RT_FAKE_LOG) ? fs.readFileSync(process.env.RT_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const waitIdle = async () => { for (let i = 0; i < 150; i++) { const c = await api(`/api/chat?pid=${pid}&cid=${cid}`); if (!c.run) return c; await new Promise(r => setTimeout(r, 80)); } };
  return { ...app, api, pid, cid, calls, waitIdle };
}

test('new installs start in English; data from before languages existed stays in Chinese', () => {
  const lang = db => migrate(db).db.settings.lang;
  assert.equal(lang(emptyDb()), 'en');
  assert.equal(lang({ schema: 2, settings: { ais: {} }, projects: [] }), 'zh-TW');
  assert.equal(lang({ schema: 2, settings: { lang: 'en', ais: {} }, projects: [] }), 'en');
  assert.equal(lang({ schema: 2, settings: { lang: 'fr', ais: {} }, projects: [] }), 'zh-TW', 'unknown values fall back to Chinese');
});

test('English prompts contain no Chinese for answers, team summary, relay, analysis, brief, images and output template', () => {
  const ai = { provider: 'claude', mode: 'auto', level: 'web', role: '' };
  const names = { claude: 'Claude', chatgpt: 'ChatGPT' };
  const steps = [{ id: 'a', kind: 'answer', ai: 'claude', round: 1, status: 'ok', text: 'Market is big' }, { id: 'b', kind: 'answer', ai: 'chatgpt', round: 1, status: 'ok', text: 'Legal risk' }];
  const turn = { id: 't', lang: 'en', q: 'Open a shop? https://example.com', mode: 'discuss', ids: ['claude', 'chatgpt'], rounds: 2, steps, roles: { claude: 'Market', chatgpt: 'Risk' },
    brief: { fields: { goal: 'Profit', budget: '' }, ask: ['budget'] }, images: [{ name: 'a.png', file: 'a.png' }], outputTemplate: 'decision', notes: [{ round: 1, text: 'Keep it short' }] };
  const project = { instructions: 'Be brief', memories: [{ type: 'decision', text: 'Use Taipei', status: 'active' }], materials: [{ id: 'm', title: 'Notes', kind: 'text', text: 'abc', share: 'all' }] };
  const r2 = buildPayload({ project, chat: { turns: [] }, turn, ai, aiId: 'claude', names, round: 2 });
  assert.match(r2.prompt, /You are taking part in a multi-AI discussion/);
  assert.match(r2.prompt, /Write your reply in the same language the user used in \[This question\] above\.[^\n]*$/, 'the reply-language rule is the last line');
  assert.match(r2.prompt, /Your role in this chat: Market/);
  assert.match(r2.prompt, /\[ChatGPT \(Risk\)\]\nLegal risk/);
  assert.match(r2.prompt, /This is round 2\./);
  assert.doesNotMatch(r2.prompt, CJK, r2.prompt.match(new RegExp('.{0,20}' + CJK.source + '.{0,20}'))?.[0]);
  const sum = buildPayload({ project, chat: { turns: [] }, turn: { ...turn, rounds: 1 }, ai, aiId: 'claude', names, kind: 'summary' });
  assert.match(sum.prompt, /You are the moderator/);
  assert.match(sum.prompt, /- Claude: Market\n- ChatGPT: Risk/);
  assert.match(sum.prompt, /\[Output format: Decision record\]/);
  assert.doesNotMatch(sum.prompt, CJK);
  const an = buildPayload({ project, chat: { turns: [] }, turn, ai, aiId: 'claude', names, kind: 'analysis' });
  assert.match(an.prompt, /You are the fact checker/);
  assert.doesNotMatch(an.prompt, CJK);
  const relay = { ...turn, mode: 'relay', roles: undefined, stages: [{ role: 'Research', ai: 'claude', task: 'Find facts', accept: 'Sources', input: 'question' }, { role: 'Plan', ai: 'chatgpt', task: '', input: 'previous' }],
    steps: [{ id: 's1', kind: 'stage', ai: 'claude', round: 1, status: 'ok', text: 'Facts' }] };
  const st = buildPayload({ project, chat: { turns: [] }, turn: relay, ai, aiId: 'chatgpt', names, kind: 'stage', round: 2 });
  assert.match(st.prompt, /This is step 2 of 2\./);
  assert.match(st.prompt, /\[Step 1: Research \(Claude\)\]\nFacts/);
  assert.doesNotMatch(st.prompt, CJK);
  const zh = buildPayload({ project: {}, chat: { turns: [] }, turn: { id: 'z', q: 'x', ids: ['claude'], rounds: 1, steps: [] }, ai, aiId: 'claude', round: 1 });
  assert.match(zh.prompt, /你正在參與一個多 AI 討論/, 'questions without a language (older data) keep Chinese prompts');
});

test('an English install sends English prompts, offers English templates, and can switch to Chinese', async () => {
  const s = await boot();
  try {
    const st = await s.api('/api/state');
    assert.equal(st.settings.lang, 'en');
    assert.deepEqual(st.settings.teamTemplates.map(t => t.name), ['Market research team', 'Product evaluation team']);
    assert.equal(st.settings.relayTemplates[0].stages[0].role, 'Research');
    assert.equal(st.settings.briefTemplates[0].name, 'Event plan');
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'Open a shop?', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 2, roles: { claude: 'Market', chatgpt: 'Risk' } });
    const c = await s.waitIdle();
    const t = c.chat.turns[0];
    assert.equal(t.lang, 'en');
    assert.equal(t.status, 'done');
    const calls = s.calls();
    assert.equal(calls.filter(x => x.round === '2').length, 2, 'the simulated CLI recognized round 2 in English');
    const sum = calls.find(x => x.round === 'sum');
    assert.match(sum.stdin, /You are the moderator/);
    for (const x of calls) assert.doesNotMatch(x.stdin.replace(/\S+ 第\S+輪的回答/g, ''), CJK, 'only the simulated answers are in Chinese');
    assert.equal((await s.api('/api/settings', { lang: 'zh-TW' })).settings.teamTemplates[0].name, '市場調查小組');
    assert.equal((await s.api('/api/settings', { lang: 'xx' })).settings.lang, 'zh-TW', 'unknown languages are ignored');
  } finally { s.quit(); }
});

test('the interface dictionary keeps placeholders consistent and translates whole fragments only', async () => {
  const EN = (await import(pathToFileURL(path.join(here, '..', 'app', 'ui', 'js', 'i18n-en.js')))).default;
  for (const [k, v] of Object.entries(EN)) {
    const plain = (k.match(/\{\}/g) || []).length, used = (v.match(/\{\d*\}/g) || []).length;
    assert.equal(used, plain, `placeholders differ: ${k}`);
    assert.doesNotMatch(v, CJK, `English text contains Chinese: ${k}`);
  }
  const { tr, useLanguage } = await import(pathToFileURL(path.join(here, '..', 'app', 'ui', 'js', 'i18n.js')));
  assert.equal(tr('送出（Ctrl+Enter）'), '送出（Ctrl+Enter）', 'Chinese mode leaves text alone');
  useLanguage('en');
  assert.equal(tr('送出（Ctrl+Enter）'), 'Send (Ctrl+Enter)');
  assert.equal(tr('Claude 第 2 輪失敗：還沒登入，或登入已過期。'), 'Claude failed in round 2: Not signed in, or the sign-in expired.');
  assert.equal(tr('ChatGPT 用量：未知　Claude 用量：未知'), 'ChatGPT usage: unknown　Claude usage: unknown');
  assert.equal(tr('市場研究的重點'), '市場研究的重點', 'text the user wrote is not half-translated');
  assert.equal(tr('職務：市場規模與競品'), 'Role: 市場規模與競品', 'user content inside a label stays as written');
});

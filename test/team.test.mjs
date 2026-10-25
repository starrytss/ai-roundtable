// 這個對話的分工：每位 AI 這次負責的職務、主持人整合、團隊範本、同一家 AI 多席（模擬 CLI）
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-team-'));
  process.env.RT_FAKE_LOG = path.join(dataDir, 'calls.jsonl');
  const app = await main({ port: 0, dataDir, open: false, protector: { protect: xor, unprotect: xor }, exitOnQuit: false });
  const page = await new Promise(r => http.get({ host: '127.0.0.1', port: app.port, path: '/', headers: { Host: `127.0.0.1:${app.port}` } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r(b)); }));
  const token = page.match(/rt-token" content="([0-9a-f]+)/)[1];
  const api = (p, body) => req(app.port, p, body, token);
  await api('/api/settings', { ais: { gemini: { ack: true } } });
  const pid = (await api('/api/state')).projects[0].id, cid = (await api('/api/chat/new', { pid })).id;
  const calls = () => fs.existsSync(process.env.RT_FAKE_LOG) ? fs.readFileSync(process.env.RT_FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const chat = async () => (await api(`/api/chat?pid=${pid}&cid=${cid}`)).chat;
  const waitIdle = async () => { for (let i = 0; i < 150; i++) { const c = await api(`/api/chat?pid=${pid}&cid=${cid}`); if (!c.run) return c; await new Promise(r => setTimeout(r, 80)); } };
  return { ...app, api, pid, cid, calls, chat, waitIdle };
}

const ROLES = { claude: '市場規模與競品', chatgpt: '風險與法規' };
const NAMES = { claude: 'Claude', chatgpt: 'ChatGPT' };
const turnWith = (extra = {}) => ({ id: 't', q: '要不要開快閃店', mode: 'discuss', ids: ['claude', 'chatgpt'], rounds: 2, steps: [], roles: ROLES, ...extra });
const okStep = (ai, round, text) => ({ id: ai + round, kind: 'answer', ai, round, status: 'ok', text });

test('each AI is told its own role for this chat, and it replaces the role in AI settings', () => {
  const p = buildPayload({ project: {}, chat: { turns: [] }, turn: turnWith(), ai: { provider: 'claude', mode: 'auto', level: 'web', role: '平常的角色' }, aiId: 'claude', names: NAMES, round: 1 });
  assert.match(p.prompt, /你這次的職務：市場規模與競品/);
  assert.match(p.prompt, /專注在這個方向/);
  assert.doesNotMatch(p.prompt, /平常的角色/);
  const plain = buildPayload({ project: {}, chat: { turns: [] }, turn: turnWith({ roles: undefined }), ai: { provider: 'claude', mode: 'auto', level: 'web', role: '平常的角色' }, aiId: 'claude', names: NAMES, round: 1 });
  assert.match(plain.prompt, /你的角色：平常的角色/);
  assert.doesNotMatch(plain.prompt, /你這次的職務/);
});

test('later rounds label each answer with its role, and the moderator integrates every direction', () => {
  const steps = [okStep('claude', 1, '市場很大'), okStep('chatgpt', 1, '有法規風險')];
  const r2 = buildPayload({ project: {}, chat: { turns: [] }, turn: turnWith({ steps }), ai: { provider: 'claude', mode: 'auto', level: 'web' }, aiId: 'claude', names: NAMES, round: 2 });
  assert.match(r2.prompt, /【ChatGPT（風險與法規）】\n有法規風險/);
  assert.match(r2.prompt, /從你的職務角度/);
  const sum = buildPayload({ project: {}, chat: { turns: [] }, turn: turnWith({ steps, rounds: 1 }), ai: { provider: 'claude', mode: 'auto', level: 'web', role: '平常的角色' }, aiId: 'claude', names: NAMES, kind: 'summary' });
  assert.match(sum.prompt, /你是主持人/);
  assert.match(sum.prompt, /- Claude：市場規模與競品\n- ChatGPT：風險與法規/);
  assert.match(sum.prompt, /整合成一份完整的結論/);
  assert.match(sum.prompt, /【Claude（市場規模與競品）】\n市場很大/);
  assert.doesNotMatch(sum.prompt, /你這次的職務|平常的角色/, 'the moderator integrates instead of keeping a research direction');
});

test('the team is saved on the chat, sent with the question, and kept for retries', async () => {
  const s = await boot({ 'codex@1': 'fail' });
  try {
    const t = await s.api('/api/chat/team', { pid: s.pid, cid: s.cid, roles: { claude: '  市場規模與競品 ', chatgpt: '風險與法規', nobody: 'x', gemini: '   ' } });
    assert.deepEqual(t.team.roles, ROLES, 'unknown AIs and empty roles are dropped');
    assert.deepEqual((await s.chat()).team.roles, ROLES);
    const pv = await s.api('/api/preview', { pid: s.pid, cid: s.cid, q: '要不要開快閃店', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 1, roles: ROLES });
    assert.deepEqual(Object.fromEntries(pv.recipients.map(r => [r.ai, r.role])), ROLES);
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: '要不要開快閃店', ids: ['claude', 'chatgpt'], mod: 'claude', rounds: 1, roles: { ...ROLES, grok: '沒有參與' } });
    await s.waitIdle();
    const turn = (await s.chat()).turns[0];
    assert.deepEqual(turn.roles, ROLES, 'only participants keep a role');
    const c = s.calls();
    assert.match(c.find(x => x.provider === 'claude' && x.round === '1').stdin, /你這次的職務：市場規模與競品/);
    assert.match(c.find(x => x.provider === 'codex').stdin, /你這次的職務：風險與法規/);
    process.env.RT_FAKE_RULES = '{}';
    const failed = turn.steps.find(x => x.ai === 'chatgpt' && x.status === 'error');
    await s.api('/api/turn/retry', { pid: s.pid, cid: s.cid, turnId: turn.id, stepIds: [failed.id] });
    await s.waitIdle();
    const again = s.calls().filter(x => x.provider === 'codex');
    assert.equal(again.length, 2);
    assert.match(again[1].stdin, /你這次的職務：風險與法規/);
    assert.equal((await s.api('/api/chat/team', { pid: s.pid, cid: s.cid, roles: {} })).team, null, 'clearing the team removes it');
  } finally { s.quit(); }
});

test('the same provider can sit twice in one chat with different roles', async () => {
  const s = await boot();
  try {
    const st = await s.api('/api/ais/add', { provider: 'claude', name: 'Claude 審查員', role: '' });
    const seat = Object.entries(st.settings.ais).find(([, a]) => a.name === 'Claude 審查員')[0];
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: '評估新產品', ids: ['claude', seat, 'chatgpt'], mod: 'chatgpt', rounds: 1, roles: { claude: '技術可行性', [seat]: '挑毛病與反對意見', chatgpt: '商業模式' } });
    await s.waitIdle();
    const cl = s.calls().filter(c => c.provider === 'claude' && c.round === '1');
    assert.equal(cl.length, 2);
    assert.ok(cl.some(c => /你這次的職務：技術可行性/.test(c.stdin)) && cl.some(c => /你這次的職務：挑毛病與反對意見/.test(c.stdin)));
    const sum = s.calls().find(c => c.round === 'sum');
    assert.match(sum.stdin, /- Claude 審查員：挑毛病與反對意見/);
  } finally { s.quit(); }
});

test('team templates can be saved, listed and deleted; relay keeps its own stages', async () => {
  const s = await boot();
  try {
    const st = await s.api('/api/state');
    assert.ok(st.settings.teamTemplates.length >= 2, 'built-in examples are offered');
    const saved = await s.api('/api/teams/save', { name: '我的研究團隊', roles: { claude: '競品', chatgpt: '', nobody: 'x' }, mod: 'claude' });
    const mine = saved.teamTemplates.find(x => x.name === '我的研究團隊');
    assert.deepEqual(mine, { name: '我的研究團隊', roles: { claude: '競品' }, mod: 'claude' });
    assert.match((await s.api('/api/teams/save', { name: '', roles: ROLES })).error, /名稱/);
    assert.ok(!(await s.api('/api/teams/delete', { name: '我的研究團隊' })).teamTemplates.some(x => x.name === '我的研究團隊'));
    await s.api('/api/send', { pid: s.pid, cid: s.cid, q: 'x', mode: 'relay', stages: [{ role: '研究', ai: 'claude', task: '查' }], review: false, roles: ROLES });
    await s.waitIdle();
    assert.equal((await s.chat()).turns[0].roles, undefined, 'relay uses the role of each stage');
  } finally { s.quit(); }
});

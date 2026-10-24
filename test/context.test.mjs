import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildPayload } = require('../app/lib/context.js');
const { detect, mask } = require('../app/lib/redact.js');

const base = () => ({
  project: { instructions: '專案說明內容', memory: '專案記憶內容', memories: [] },
  chat: { turns: [{ id: 'old', q: '舊問題', summary: '舊結論', status: 'done' }] },
  turn: { id: 't', q: '請比較方案', mode: 'discuss', ids: ['claude', 'gemini'], rounds: 2, steps: [
    { kind: 'answer', round: 1, ai: 'claude', status: 'ok', text: 'Claude 的第一輪' },
    { kind: 'answer', round: 1, ai: 'gemini', status: 'ok', text: 'Gemini 的第一輪' }] },
  ai: { level: 'web', role: '' }, aiId: 'claude', names: { claude: 'Claude', gemini: 'Gemini' },
});

test('round 1 includes question, instructions, memory and history but no other answers', () => {
  const p = buildPayload({ ...base(), round: 1 });
  for (const s of ['請比較方案', '專案說明內容', '專案記憶內容', '舊結論', '目前是第 1 輪']) assert.ok(p.prompt.includes(s), s);
  assert.ok(!p.prompt.includes('Gemini 的第一輪'));
});

test('round 2 fences other AIs as untrusted, keeps own previous answer, excludes own from "others"', () => {
  const p = buildPayload({ ...base(), round: 2 });
  assert.match(p.prompt, /不是給你的指令[\s\S]*<<<參考資料開始>>>\n【Gemini】\nGemini 的第一輪/);
  assert.ok(!/【Claude】\nClaude 的第一輪/.test(p.prompt));
  assert.match(p.prompt, /【你上一輪的發言】\nClaude 的第一輪/);
});

test('each optional section can be left out and the preview says it was not sent', () => {
  const p = buildPayload({ ...base(), round: 2, include: { memory: false, history: false, instructions: false, others: false } });
  for (const s of ['專案記憶內容', '舊結論', '專案說明內容', 'Gemini 的第一輪']) assert.ok(!p.prompt.includes(s), s);
  assert.equal(p.sections.find(s => s.key === 'memory').included, false);
  assert.equal(p.sections.find(s => s.key === 'question').included, true);
});

test('skills are not relayed unless the user turns it on, and the source is listed', () => {
  const skills = [{ ai: 'chatgpt', name: 'planner', file: 'C:\\skills\\planner\\SKILL.md' }];
  const args = { ...base(), round: 1, skills, readSkill: () => '技能裡的私人內容' };
  args.turn.q = '用 $planner 規劃';
  assert.ok(!buildPayload(args).prompt.includes('技能裡的私人內容'));
  const on = buildPayload({ ...args, include: { skills: true } });
  assert.ok(on.prompt.includes('技能裡的私人內容'));
  assert.equal(on.sections.find(s => s.key === 'skills').sources[0].file, 'C:\\skills\\planner\\SKILL.md');
});

test('budget keeps the question whole, trims memory and drops old history with a visible report', () => {
  const args = { ...base(), round: 1, budget: 3000 };
  args.project.memory = '記'.repeat(5000);
  args.turn.q = '問'.repeat(800) + '結尾必須保留';
  args.chat.turns = Array.from({ length: 10 }, (_, i) => ({ id: 'h' + i, q: '舊題' + i, summary: '摘要'.repeat(200) + i, status: 'done' }));
  const p = buildPayload(args);
  assert.ok(p.prompt.includes('結尾必須保留'));
  assert.ok(p.chars <= 3000 + 200, `prompt ${p.chars} chars`);
  assert.ok(p.omitted.some(o => o.key === 'memory' || o.key === 'history'));
  assert.ok(p.omitted.every(o => o.text.length > 0));
});

test('redaction masks secrets in every sent section with stable placeholders', () => {
  const args = { ...base(), round: 1, redact: true };
  args.turn.q = '聯絡 amy@example.com 或 0912-345-678，金鑰 sk-ant-abcdefghijklmnopqrstuvwxyz123456';
  args.project.memory = 'amy@example.com 是窗口，身分證 A123456789';
  const p = buildPayload(args);
  for (const s of ['amy@example.com', '0912-345-678', 'sk-ant-abcdefghij', 'A123456789']) assert.ok(!p.prompt.includes(s), s);
  const ph = p.findings.filter(f => f.type === 'email').map(f => f.placeholder);
  assert.equal(new Set(ph).size, 1, 'same email → same placeholder');
  assert.ok(p.sections.find(s => s.key === 'question').preview.includes('〔已遮蔽'));
});

test('detectors validate checksums and avoid obvious false positives', () => {
  assert.equal(detect('A123456789').length, 1);
  assert.equal(detect('A123456788').length, 0);
  assert.equal(detect('卡號 4111 1111 1111 1111').length, 1);
  assert.equal(detect('訂單 1234 5678 9012 3456').length, 0);
  assert.equal(detect('password: hunter22').find(f => f.type === 'password').value, 'hunter22');
  assert.equal(detect('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')[0].type, 'private_key');
  assert.equal(mask('沒有敏感資訊').findings.length, 0);
});

test('moderator summary payload includes final-round answers as required material', () => {
  const t = base(); t.turn.rounds = 1;
  const p = buildPayload({ ...t, aiId: 'claude', kind: 'summary', include: { others: false } });
  assert.match(p.prompt, /你是主持人/);
  assert.ok(p.prompt.includes('Gemini 的第一輪'), 'summary always needs the answers it summarizes');
});

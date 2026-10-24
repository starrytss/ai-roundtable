import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { PROVIDERS, invocation, guarantee, needsAck } = require('../app/lib/providers.js');
const { createParser } = require('../app/lib/parsers.js');
const { run, scrub } = require('../app/lib/runner.js');
const { classify } = require('../app/lib/errors.js');

const FAKE = path.join(here, 'fake-cli.mjs');
process.env.RT_FAKE_CLI = JSON.stringify(Object.fromEntries(['claude', 'codex', 'agy', 'grok'].map(n => [n, [process.execPath, FAKE, n === 'agy' ? 'gemini' : n]])));
const fixture = n => fs.readFileSync(path.join(here, 'fixtures', n + '.jsonl'), 'utf8');
const parseAll = (kind, text) => { const p = createParser(kind), ev = p.push(text); return { ev, ...p.end() }; };

test('Claude: permission level maps to an enforced --tools list, isolation flags and no prompt in argv', () => {
  const a = PROVIDERS.claude.build({ level: 'text' }).args;
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(!a.includes('--allowedTools'));
  for (const f of ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts']) assert.ok(a.includes(f), f);
  assert.match(a[a.indexOf('--settings') + 1], /blockReadsOutsideWorkingDirectories/);
  assert.equal(PROVIDERS.claude.build({ level: 'web' }).args.at(PROVIDERS.claude.build({ level: 'web' }).args.indexOf('--tools') + 1), 'WebSearch,WebFetch');
  assert.match(PROVIDERS.claude.build({ level: 'exec' }).args.join(' '), /Bash/);
  assert.equal(PROVIDERS.claude.build({ level: 'web', reduceTraffic: true }).env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(guarantee({ provider: 'claude', level: 'write' }).level, 'enforced');
  assert.equal(guarantee({ provider: 'claude', level: 'exec' }).level, 'none');
});

test('Codex: sandbox and search follow the level, the work folder is pinned and user config is ignored', () => {
  const t = PROVIDERS.codex.build({ level: 'text', workdir: 'C:\\w', model: 'm1' }).args;
  assert.ok(!t.includes('--search'));
  assert.equal(t[t.indexOf('-s') + 1], 'read-only');
  assert.equal(t[t.indexOf('-C') + 1], 'C:\\w');
  assert.ok(t.includes('--ignore-user-config') && t.includes('--ephemeral') && t.at(-1) === '-');
  assert.equal(t[t.indexOf('-m') + 1], 'm1');
  const w = PROVIDERS.codex.build({ level: 'write', workdir: 'C:\\w' }).args;
  assert.equal(w[0], '--search'); assert.equal(w[1], 'exec');
  assert.equal(w[w.indexOf('-s') + 1], 'workspace-write');
  assert.equal(guarantee({ provider: 'codex', level: 'text' }).level, 'partial');
  assert.ok(guarantee({ provider: 'codex', level: 'text' }).notes.some(n => /讀取電腦上的檔案/.test(n)));
});

test('Gemini (agy): prompt goes to stdin as a stream-json user event, guarantee is none and auto mode needs acknowledgement', () => {
  const b = PROVIDERS.gemini.build({});
  assert.ok(b.args.includes('--print=') && b.args.includes('--disable-slash-commands'));
  assert.ok(!b.args.some(a => a.includes('秘密')));
  assert.deepEqual(JSON.parse(b.input('秘密問題')), { event: 'user', message: { role: 'user', content: '秘密問題' } });
  assert.equal(guarantee({ provider: 'gemini' }).level, 'none');
  assert.equal(needsAck({ provider: 'gemini', mode: 'auto', ack: false }), true);
  assert.equal(needsAck({ provider: 'gemini', mode: 'auto', ack: true }), false);
  assert.equal(needsAck({ provider: 'gemini', mode: 'manual' }), false);
  assert.equal(needsAck({ provider: 'claude', mode: 'auto', level: 'web' }), false);
});

test('real fixtures: final text, tool events with query/url, and Claude rate-limit info are extracted', () => {
  const c = parseAll('claude', fixture('claude-web'));
  assert.match(c.text, /LTS/);
  assert.ok(c.ev.some(e => e.type === 'tool' && e.name === 'WebSearch' && e.query));
  assert.ok(c.ev.some(e => e.type === 'tool' && e.name === 'WebFetch' && e.url));
  assert.equal(parseAll('claude', fixture('claude-text')).rateLimit.rateLimitType, 'five_hour');
  const x = parseAll('codex', fixture('codex-web'));
  assert.match(x.text, /24/); assert.ok(!/我會查詢/.test(x.text), 'final answer, not the preamble');
  assert.ok(x.ev.some(e => e.name === 'web_search' && e.phase === 'end' && e.domains.includes('nodejs.org')));
  const g = parseAll('agy', fixture('agy-web'));
  assert.match(g.text, /24/);
  assert.ok(g.ev.some(e => e.name === 'search_web' && e.query));
  assert.ok(parseAll('agy', fixture('agy-write')).ev.some(e => e.kind === 'write' && e.path));
  assert.equal(parseAll('codex', fixture('codex-text')).text, 'OK');
});

test('parser handles lines split across chunks and a max-turns result as an error', () => {
  const p = createParser('claude'), line = JSON.stringify({ type: 'result', subtype: 'error_max_turns' }) + '\n';
  p.push(line.slice(0, 10)); p.push(line.slice(10));
  assert.match(p.end().error, /max turns/);
});

test('runner: stdin carries the prompt, argv does not, and the final text comes back', async () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-run-')), 'log.jsonl');
  process.env.RT_FAKE_LOG = log; process.env.RT_FAKE_RULES = '{}';
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-wd-'));
  for (const provider of ['claude', 'codex', 'gemini']) {
    const inv = invocation({ provider, level: 'web', mode: 'auto' }, { workdir });
    const r = await run(inv, '敏感的提問內容 目前是第 1 輪', { cwd: workdir });
    assert.match(r.text, /第1輪的回答/);
  }
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 3);
  for (const c of calls) { assert.ok(c.stdin.includes('敏感的提問內容')); assert.ok(!c.args.join(' ').includes('敏感')); assert.equal(fs.realpathSync(c.cwd), fs.realpathSync(workdir)); }
  delete process.env.RT_FAKE_LOG;
});

test('runner: timeout and abort end the process; failures are classified', async () => {
  const inv = invocation({ provider: 'claude', level: 'text', mode: 'auto' }, { workdir: os.tmpdir() });
  process.env.RT_FAKE_RULES = JSON.stringify({ claude: 'hang' });
  await assert.rejects(run(inv, 'x', { cwd: os.tmpdir(), timeoutMs: 400 }), e => e.code === 'TIMEOUT');
  const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
  await assert.rejects(run(inv, 'x', { cwd: os.tmpdir(), signal: ac.signal }), e => e.code === 'ABORT');
  for (const [rule, kind] of [['login', 'login'], ['quota', 'quota'], ['fail', 'other'], ['empty', 'other']]) {
    process.env.RT_FAKE_RULES = JSON.stringify({ claude: rule });
    await assert.rejects(run(inv, 'x', { cwd: os.tmpdir() }), e => classify(e).kind === kind);
  }
  process.env.RT_FAKE_RULES = '{}';
});

test('error classification covers missing CLI, incompatible version and max turns; prompt text is scrubbed', () => {
  assert.equal(classify(new Error('找不到程式 claude')).action, 'install');
  assert.equal(classify(new Error("error: unknown option '--safe-mode'")).kind, 'incompatible');
  assert.equal(classify(new Error('Error: Reached max turns (8)')).kind, 'turns');
  const prompt = '這是一段很長的私人提問內容，包含客戶名單與報價，不應該出現在錯誤訊息裡面喔喔喔';
  assert.ok(!scrub('Error: bad input: ' + prompt, prompt).includes('客戶名單'));
});

test('missing CLI is reported instead of throwing', () => {
  const saved = process.env.RT_FAKE_CLI; process.env.RT_FAKE_CLI = '{}';
  assert.deepEqual(invocation({ provider: 'custom', cmd: 'definitely-not-installed-xyz --a', level: 'web' }, { workdir: '.' }), { missing: 'definitely-not-installed-xyz' });
  process.env.RT_FAKE_CLI = saved;
});

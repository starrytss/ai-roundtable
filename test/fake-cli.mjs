// 模擬 CLI（只用於自動測試，不連任何服務）。用法：node fake-cli.mjs <provider> [CLI 參數...]
// RT_FAKE_RULES = {"claude":"ok","gemini@2":"fail","chatgpt@sum":"fail", ...}，值可為 ok | fail | slow | login | quota | hang | empty
// RT_FAKE_LOG = 每次呼叫附加一行 JSON（provider、參數、stdin、cwd）
import fs from 'node:fs';
const [, , provider, ...args] = process.argv;
const rules = JSON.parse((process.env.RT_FAKE_RULES_FILE && fs.existsSync(process.env.RT_FAKE_RULES_FILE) && fs.readFileSync(process.env.RT_FAKE_RULES_FILE, 'utf8')) || process.env.RT_FAKE_RULES || '{}');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => input += d);
process.stdin.on('end', main);

function main() {
  if (args.includes('--version')) { process.stdout.write('fake-cli 0.0.0\n'); process.exit(0); }
  if (args.includes('--help')) { process.stdout.write(process.env.RT_FAKE_HELP ?? '--restricted --safe-mode --tools stream-json --ignore-user-config --ephemeral --json --input-format --disable-slash-commands\n'); process.exit(0); }
  if (args[0] === 'auth' || args[0] === 'login') { process.stdout.write(process.env.RT_FAKE_LOGGEDIN === '0' ? 'Not logged in\n' : '{"loggedIn": true}\n'); process.exit(0); }
  let prompt = input;
  if (provider === 'gemini') { try { prompt = JSON.parse(input.trim()).message.content; } catch {} }
  if (args.includes('{prompt}')) prompt = '';
  const stage = (prompt.match(/目前是第 (\d+) 棒/) || [])[1];
  const round = /你是查核整理員/.test(prompt) ? 'analysis' : /你是主持人/.test(prompt) ? 'sum' : stage ? 'S' + stage : (prompt.match(/目前是第 (\d+) 輪/) || [])[1] || '1';
  const who = process.env.RT_FAKE_AS || provider;
  const rule = rules[`${who}@${round}`] || rules[who] || 'ok';
  if (process.env.RT_FAKE_LOG) fs.appendFileSync(process.env.RT_FAKE_LOG, JSON.stringify({ provider: who, round, args, stdin: prompt, cwd: process.cwd(), at: Date.now() }) + '\n');
  const answer = round === 'analysis' ? ANALYSIS : rule === 'same' ? `${who} 每一輪都說一樣的話，沒有新的資訊` : `${who} 第${round}輪的回答`;
  if (rule === 'hang') return setTimeout(() => {}, 1e9);
  if (rule === 'slow') return setTimeout(() => emit(answer), 1500);
  if (rule === 'login') { process.stderr.write('Error: Not logged in. Please log in.'); process.exit(1); }
  if (rule === 'quota') { process.stderr.write('Error: usage limit reached (429)'); process.exit(1); }
  if (rule === 'fail') { process.stderr.write('Error: simulated failure'); process.exit(1); }
  if (rule === 'empty') process.exit(0);
  emit(answer);
}

function emit(text) {
  const out = s => process.stdout.write(JSON.stringify(s) + '\n');
  if (provider === 'claude') {
    out({ type: 'system', subtype: 'init', tools: [] });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'fake query' } }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result' }] } });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com/read' } }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result' }] } });
    out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    out({ type: 'result', subtype: 'success', result: text, usage: { output_tokens: 5 } });
  } else if (provider === 'codex') {
    out({ type: 'thread.started' }); out({ type: 'item.completed', item: { type: 'agent_message', text } }); out({ type: 'turn.completed', usage: {} });
  } else if (provider === 'gemini') {
    out({ event: 'init', init: { tools: [] } }); out({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: text } });
    out({ event: 'result', result: { status: 'SUCCESS', response: text } });
  } else process.stdout.write(text);
  process.exit(0);
}

// 查核整理的模擬回覆：一個主張有讀取紀錄、一個只有引用網址、一個是推論
const ANALYSIS = '整理如下\n```json\n' + JSON.stringify({ consensus: [{ point: '都建議 A', by: ['Claude', 'Gemini'], reason: '成本低' }], disagreements: [{ point: '時程', positions: [{ by: 'Claude', stance: '一個月', reason: '' }, { by: 'Gemini', stance: '兩個月', reason: '' }] }], claims: [{ claim: '有讀取來源的主張', sources: ['https://example.com/read'], status: 'supported' }, { claim: '只有引用的主張', sources: ['https://example.com/unread'], status: 'supported' }, { claim: '推論', status: 'inference' }], toVerify: ['價格'], toDecide: ['選 A 或 B'] }) + '\n```';

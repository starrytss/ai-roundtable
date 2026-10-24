// 執行一次 CLI：不經過 shell、提示走標準輸入、逾時與中止會結束整個程序樹
const { spawn, execFile } = require('child_process');
const { createParser } = require('./parsers');

const decode = b => { const u = b.toString('utf8'); if (!u.includes('�')) return u; try { return new TextDecoder('big5').decode(b); } catch { return u; } };
function killTree(p) {
  if (!p || p.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else p.kill('SIGKILL');
}
// 錯誤訊息裡如果夾帶了提示原文，只留前面的說明，避免把對話內容寫進錯誤紀錄
function scrub(msg, prompt) {
  let m = String(msg || '');
  for (const probe of [prompt.slice(0, 40), prompt.slice(-40)]) {
    if (probe.length >= 20) { const i = m.indexOf(probe); if (i >= 0) m = m.slice(0, i) + '…（已移除提示內容）'; }
  }
  return m.slice(-600);
}

function run(inv, prompt, { cwd, timeoutMs = 600000, signal, onEvent = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const args = inv.argvPrompt ? inv.args.map(a => (a === '{prompt}' ? prompt : a)) : inv.args;
    const parser = createParser(inv.parser), events = [], t0 = Date.now();
    let p, done = false, why = null;
    try { p = spawn(inv.exe, args, { cwd, env: { ...process.env, ...(inv.env || {}) }, windowsHide: true, shell: false }); }
    catch (e) { return reject(Object.assign(new Error(e.message), { code: e.code })); }
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => { why = 'timeout'; killTree(p); }, timeoutMs);
    const onAbort = () => { why = 'abort'; killTree(p); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort); }
    const err = [];
    p.on('error', e => finish(Object.assign(new Error(e.code === 'ENOENT' ? `找不到程式 ${inv.exe}` : e.message), { code: e.code })));
    p.stdout.on('data', d => {
      for (const ev of parser.push(decode(d))) { ev.t = Date.now() - t0; if (events.length < 300 && ev.type !== 'text') events.push(ev); onEvent(ev); }
    });
    p.stderr.on('data', d => err.push(d));
    p.on('close', code => {
      const r = parser.end(), stderr = decode(Buffer.concat(err)).trim();
      if (why === 'timeout') return finish(Object.assign(new Error(`逾時（${Math.round(timeoutMs / 60000) || 1} 分鐘）`), { code: 'TIMEOUT' }));
      if (why === 'abort') return finish(Object.assign(new Error('已中止'), { code: 'ABORT' }));
      if (code === 0 && r.text && !r.error) return finish(null, { text: r.text, usage: r.usage, rateLimit: r.rateLimit, events, ms: Date.now() - t0 });
      finish(Object.assign(new Error(scrub(r.error || stderr || (inv.parser === 'text' ? r.text : '') || `結束碼 ${code}`, prompt)), { code: 'EXIT', exitCode: code, rateLimit: r.rateLimit }));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(inv.argvPrompt ? '' : inv.input(prompt));
  });
}

module.exports = { run, killTree, scrub, decode };

// 連線診斷：分開判斷「未安裝／版本不相容／未登入／尚未測試／測試通過／額度不足／測試失敗」，已安裝不等於可用
const { spawn } = require('child_process');
const { PROVIDERS, invocation, resolveExe } = require('./providers');
const { run, decode } = require('./runner');
const { classify } = require('./errors');

function quick(exe, args, ms = 15000) {
  return new Promise(res => {
    let out = Buffer.alloc(0), p;
    try { p = spawn(exe, args, { windowsHide: true, shell: false }); } catch { return res({ ok: false, out: '' }); }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    p.stdout.on('data', d => out = Buffer.concat([out, d])); p.stderr.on('data', d => out = Buffer.concat([out, d]));
    p.on('error', () => { clearTimeout(t); res({ ok: false, out: '' }); });
    p.on('close', code => { clearTimeout(t); res({ ok: code === 0, out: decode(out).trim() }); });
    p.stdin.on('error', () => {}); p.stdin.end();   // 不給輸入，避免等待輸入的程式卡住
  });
}

const NEXT = {
  not_installed: '按「安裝」會開一個視窗，先顯示安裝程式的來源網址，確認後才下載執行；完成後按「重新檢查」。',
  incompatible: '這個 CLI 版本太舊，缺少本程式需要的安全參數。請更新後再測試。',
  not_logged_in: '按「登入」會開一個視窗，照指示登入後再按「測試」。',
  untested: '已安裝，但還沒確認能正常回答。按「測試」會送出一句很短的測試問題。',
  ok: '測試通過。',
  quota: '這個帳號目前用量已滿或被暫時限制，稍後再測試，或先改用其他 AI。',
  failed: '測試沒有通過，請看錯誤說明。',
  manual: '手動貼上模式：提問時會請你把提示貼到它的網站，再把回覆貼回來。',
};

async function check(id, ai, last) {
  const r = { id, name: ai.name, provider: ai.provider, mode: ai.mode, installed: false, path: '', version: '', loggedIn: null, compatible: null, missingFlags: [], last: last || null };
  if (ai.mode === 'manual') return { ...r, status: 'manual', next: NEXT.manual };
  const P = PROVIDERS[ai.provider];
  const exeName = ai.provider === 'custom' ? (String(ai.cmd).match(/^"[^"]+"|^\S+/) || [''])[0].replace(/"/g, '') : P.exe;
  const x = exeName && resolveExe(exeName);
  if (!x) return { ...r, status: 'not_installed', next: NEXT.not_installed, exe: exeName };
  Object.assign(r, { installed: true, path: x.path, exe: exeName });
  const v = await quick(x.exe, [...x.pre, '--version']); r.version = (v.out.split(/\r?\n/)[0] || '').slice(0, 80);
  const needs = P?.setup?.needs || [];
  if (needs.length) {
    const h = await quick(x.exe, [...x.pre, ...(ai.provider === 'codex' ? ['exec', '--help'] : ['--help'])]);
    r.missingFlags = needs.filter(f => !h.out.includes(f)); r.compatible = h.out ? !r.missingFlags.length : null;
    if (r.compatible === false) return { ...r, status: 'incompatible', next: NEXT.incompatible };
  }
  if (P?.setup?.status) {
    const s = await quick(x.exe, [...x.pre, ...P.setup.status]);
    r.loggedIn = s.ok && !/not logged in|"loggedIn":\s*false/i.test(s.out) ? true : (/not logged in|"loggedIn":\s*false/i.test(s.out) ? false : null);
    if (r.loggedIn === false) return { ...r, status: 'not_logged_in', next: NEXT.not_logged_in };
  }
  if (!last) return { ...r, status: 'untested', next: NEXT.untested };
  const status = last.ok ? 'ok' : last.kind === 'quota' ? 'quota' : last.kind === 'login' ? 'not_logged_in' : last.kind === 'incompatible' ? 'incompatible' : 'failed';
  return { ...r, status, next: status === 'failed' ? last.text : NEXT[status] };
}

// 實際送一句短問題；用「只用文字回答」的權限，不讓它使用工具
async function test(ai, { workdir, lang } = {}) {
  const t0 = Date.now();
  try {
    const inv = invocation({ ...ai, level: 'text' }, { workdir });
    if (inv.missing) throw Object.assign(new Error('找不到程式 ' + inv.missing), { code: 'ENOENT' });
    const r = await run(inv, require('./context').promptsFor(lang).connectionTest, { cwd: workdir, timeoutMs: 120000 });
    return { ok: true, at: Date.now(), ms: Date.now() - t0, text: `連線成功（${Math.round((Date.now() - t0) / 1000)} 秒）：${r.text.slice(0, 40)}`, rateLimit: r.rateLimit || null };
  } catch (e) { const k = classify(e); return { ok: false, at: Date.now(), kind: k.kind, text: k.text, raw: k.raw, action: k.action }; }
}

module.exports = { check, test, NEXT };

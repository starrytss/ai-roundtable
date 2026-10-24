// 共用工具與狀態
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
const TOKEN = document.querySelector('meta[name=rt-token]')?.content || '';   // 伺服器每次啟動換一組，只有這個視窗拿得到
export const tokenParam = () => 't=' + TOKEN;

export async function api(u, b) {
  const r = await fetch(u, { headers: { 'X-RT-Token': TOKEN }, ...(b === undefined ? {} : { method: 'POST', body: JSON.stringify(b) }) });
  if (r.status === 403) { location.reload(); return new Promise(() => {}); }   // 伺服器重開過，token 已換
  return r.json();
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const S = { D: { projects: [], settings: { ais: {} }, levels: [] }, pid: localStorage.pid, cid: localStorage.cid, chat: null, run: null, offset: 0, pref: {} };
try { S.pref = JSON.parse(localStorage.pref || '{}'); } catch {}
export const savePref = () => { localStorage.pref = JSON.stringify(S.pref); };

export const AVI = { chatgpt: 'G', claude: 'C', gemini: '✦', grok: 'X' };
export const P = () => S.D.projects.find(p => p.id === S.pid);
export const ai = id => S.D.settings.ais[id] || { name: id, mode: 'manual' };
export const col = id => `var(--${id in AVI ? id : 'grok'})`;
export const av = id => `<span class="av" style="--c:${col(id)}">${AVI[id] || esc((ai(id).name || '?')[0])}</span>`;
export const secs = ms => (ms < 60000 ? Math.round(ms / 1000) + ' 秒' : Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒');
export function when(ts) { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? d.toTimeString().slice(0, 5) : `${d.getMonth() + 1}/${d.getDate()}`; }
export function toast(t, ms = 2200) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), ms); }
export const copy = async (t, msg) => { await navigator.clipboard.writeText(t || ''); toast(msg || '已複製'); };

export const GUARANTEE = { enforced: ['enforced', 'CLI 強制'], partial: ['partial', '部分強制'], none: ['none', '無法限制'], manual: ['manual', '手動貼上'] };
export const badge = g => { const [c, t] = GUARANTEE[g?.level] || GUARANTEE.manual; return `<span class="badge ${c}">${t}</span>`; };
export const STATUS = { done: '完成', partial: '部分完成', failed: '失敗', stopped: '已中止', interrupted: '已中斷', running: '進行中', waiting: '等待中' };
export function reasonText(r) {
  const n = id => esc(ai(id).name);
  return ({
    all_failed: '所有 AI 都沒有成功回答', stopped: '你按了中止', interrupted: '程式在討論中被關閉', pending: '還有步驟沒有執行',
    answer_failed: `${n(r.ai)} 第 ${r.round} 輪失敗：${esc(r.text)}`, answer_skipped: `${n(r.ai)} 第 ${r.round} 輪被略過`,
    last_round_empty: `第 ${r.round} 輪沒有成功的回答`, no_summary: '沒有產生主持人總結', summary_failed: `主持人 ${n(r.ai)} 總結失敗：${esc(r.text)}`,
  })[r.code] || esc(r.code);
}
// 工具事件 → 文字（只顯示 CLI 真的回報的動作）
export function evText(e) {
  const k = { search: '搜尋', web: '讀取網頁', read: '讀取檔案', write: '寫入檔案', exec: '執行指令', tool: '使用工具' }[e.kind] || '使用工具';
  const what = e.query || e.url || e.path || e.command || (e.domains || []).join('、') || e.name || '';
  return `${k}${what ? '：' + what : ''}`;
}

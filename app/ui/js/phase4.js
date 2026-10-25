// 第四階段：圖片附件、任務佇列、本機搜尋與標籤、收藏、匿名比較、新增席位
import { $, S, api, esc, ai, av, toast, savePref, when, P } from './core.js';
import { renderExtras, refreshCheck, req } from './composer.js';
import { md } from './md.js';

const IMG = { direct: '直接看圖', tool: '用讀檔工具看圖', manual: '請你自行上傳到網站', none: '看不到圖片', unknown: '未驗證' };
export const imageLabel = m => IMG[m] || m;

/* ---------- 圖片附件 ---------- */
const thumbs = {};   // 只在這個視窗暫存縮圖，不寫進設定
export function bindImages() {
  $('#imgbtn').onclick = () => { if (!S.cid) return toast('請先開始一個對話，或直接輸入問題送出後再附圖'); $('#imgfile').click(); };
  $('#imgfile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      if ((S.pref.images || []).length >= 5) { toast('每次最多 5 張圖片'); break; }
      if (f.size > 10 * 1024 * 1024) { toast(`${f.name} 超過 10 MB`); continue; }
      const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const res = await api('/api/attachments/add', { pid: S.pid, cid: S.cid, name: f.name, mime: f.type, data: String(dataUrl).split(',')[1] });
      if (res.error) { toast(`${f.name}：${res.error}`, 4000); continue; }
      thumbs[res.attachment.id] = { url: dataUrl, name: res.attachment.name };
      S.pref.images = [...(S.pref.images || []), res.attachment.id]; savePref();
    }
    renderExtras(); refreshCheck();
  };
}
export function imageChips() {
  const ids = S.pref.images || [];
  if (!ids.length) return '';
  return `<span class="skchip"><b>🖼 圖片 ${ids.length} 張</b>${ids.map(id => thumbs[id] ? `<img class="thumb" src="${thumbs[id].url}" alt="${esc(thumbs[id].name)}">` : '').join('')}<small>只存在這台電腦（原檔，未加密）</small><button data-rmimg title="移除圖片">✕</button></span>`;
}
export async function clearImages(deleteFiles) {
  if (deleteFiles) for (const id of S.pref.images || []) await api('/api/attachments/delete', { pid: S.pid, cid: S.cid, id });
  S.pref.images = []; savePref(); renderExtras(); refreshCheck();
}

/* ---------- 任務佇列 ---------- */
const QST = { queued: '等待中', running: '執行中', finished: '已結束', canceled: '已取消', failed: '無法開始', interrupted: '程式關閉時中斷' };
export async function addToQueue(after) {
  const q = $('#q').value.trim(); if (!q) return toast('請先輸入問題');
  if (!S.cid) S.cid = (await api('/api/chat/new', { pid: S.pid })).id;
  const r = await api('/api/queue/add', req());
  if (r.error) return toast(r.error, 4000);
  $('#q').value = ''; S.pref.quote = null; S.pref.brief = null; S.pref.images = []; savePref(); renderExtras();
  toast(`已排進佇列（共 ${r.queue} 項）。下一個任務會在新的提問結束後自動開始`); after();
}
export function renderQueueCount() { const n = (S.D.queue || []).filter(q => ['queued', 'running'].includes(q.status)).length; $('#qcount').textContent = n ? n : ''; }
export function openQueue() {
  const Q = S.D.queue || [], chatTitle = q => (S.D.projects.find(p => p.id === q.pid)?.chats.find(c => c.id === q.cid) || {}).title || '（對話已刪除）';
  $('#queueBody').innerHTML = `<div class="small">佇列一次執行一個任務，每個任務的回答會存到它自己的對話；需要手動貼上的步驟也會標示是哪個對話。${S.D.queuePaused ? '<br><b>佇列目前暫停</b>（程式重新開啟後不會自動開始）。' : ''}</div>
    <div class="blist" style="margin-top:8px">${Q.slice().reverse().map(q => `<div><span class="st ${q.status === 'finished' ? (q.result === 'done' ? 'done' : 'partial') : q.status === 'running' ? 'running' : q.status === 'queued' ? 'waiting' : 'failed'}" style="font-size:11px">${QST[q.status] || q.status}${q.status === 'finished' && q.result !== 'done' ? '（' + esc(q.result) + '）' : ''}</span>
      <span class="grow"><b>${esc(q.q)}</b><span class="small">　→「${esc(chatTitle(q))}」　${when(q.at)}${q.error ? '　' + esc(q.error) : ''}</span></span>
      ${q.status === 'queued' ? `<button class="btn" data-qcancel="${q.id}">取消</button>` : ''}${q.turnId ? `<button class="btn" data-qopen="${q.pid}|${q.cid}">開啟</button>` : ''}</div>`).join('') || '<div>佇列是空的</div>'}</div>`;
  $('#qPause').textContent = S.D.queuePaused ? '繼續執行佇列' : '暫停佇列';
  if (!$('#dlgQueue').open) $('#dlgQueue').showModal();
}
export function bindQueue(reload) {
  $('#queueBody').onclick = async e => {
    if (e.target.dataset.qcancel) { await api('/api/queue/cancel', { id: e.target.dataset.qcancel }); await reload(); return openQueue(); }
    if (e.target.dataset.qopen) { const [pid, cid] = e.target.dataset.qopen.split('|'); S.pid = pid; S.cid = cid; $('#dlgQueue').close(); return reload(); }
  };
  $('#qClear').onclick = async () => { await api('/api/queue/clear', {}); await reload(); openQueue(); };
  $('#qPause').onclick = async () => { await api('/api/queue/resume', { pause: !S.D.queuePaused }); await reload(); openQueue(); };
}

/* ---------- 搜尋、標籤、收藏 ---------- */
export function openSearch() {
  const tags = [...new Set(S.D.projects.flatMap(p => p.chats.flatMap(c => c.tags || [])))];
  $('#sAi').innerHTML = '<option value="">所有 AI</option>' + Object.keys(S.D.settings.ais).map(k => `<option value="${k}">${esc(ai(k).name)}</option>`).join('');
  $('#sTag').innerHTML = '<option value="">所有標籤</option>' + tags.map(t => `<option>${esc(t)}</option>`).join('');
  if (!$('#dlgSearch').open) $('#dlgSearch').showModal();
  $('#sQ').focus();
}
const KIND = { question: '問題', answer: '回答', summary: '總結', stage: '接力', analysis: '整理' };
export function bindSearch(reload) {
  const go = async () => {
    const d = v => (v ? new Date(v + 'T00:00:00').getTime() : 0);
    const r = await api('/api/search', { q: $('#sQ').value, ai: $('#sAi').value, tag: $('#sTag').value, from: d($('#sFrom').value), to: $('#sTo').value ? d($('#sTo').value) + 86399999 : 0, fav: $('#sFav').checked });
    if (r.error) return toast(r.error);
    $('#sOut').innerHTML = `<div class="small" style="margin:8px 0">找到 ${r.results.length} 筆${r.results.length >= 200 ? '（只顯示前 200 筆）' : ''}</div>` + r.results.map(x => `<div class="sres" data-go="${x.pid}|${x.cid}|${x.stepId || ''}">
      <b>${esc(x.chat)}</b><span class="small">　${esc(x.project)} · ${KIND[x.kind] || x.kind}${x.ai ? ' · ' + esc(ai(x.ai).name) : ''} · ${when(x.at)}${x.favorite ? ' · ★' : ''}${(x.tags || []).map(t => ' #' + esc(t)).join('')}</span><div class="small">${esc(x.snippet)}</div></div>`).join('');
  };
  $('#sGo').onclick = go;
  $('#sQ').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#sOut').onclick = async e => {
    const it = e.target.closest('[data-go]'); if (!it) return;
    const [pid, cid, step] = it.dataset.go.split('|');
    S.pid = pid; S.cid = cid; $('#dlgSearch').close(); await reload();
    if (step) setTimeout(() => { const el = document.getElementById('step-' + step); if (el) { el.closest('details')?.setAttribute('open', ''); el.scrollIntoView({ block: 'center' }); el.animate([{ outline: '3px solid var(--gold)' }, { outline: '3px solid transparent' }], { duration: 1600 }); } }, 300);
  };
}
export function renderTags() {
  const tags = S.chat?.tags || [];
  $('#tagline').innerHTML = tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('');
  $('#tagbtn').hidden = !S.chat;
}
export async function editTags() {
  if (!S.chat) return;
  const v = prompt('標籤（用空白或逗號分隔，最多 10 個）', (S.chat.tags || []).join(' ')); if (v === null) return;
  const r = await api('/api/chat/tags', { pid: S.pid, cid: S.cid, tags: v.split(/[\s,，、]+/) });
  if (r.error) return toast(r.error); S.chat.tags = r.tags; renderTags(); toast('已更新標籤');
}
export async function toggleFavorite(turnId, stepId, on) {
  const r = await api('/api/step/favorite', { pid: S.pid, cid: S.cid, turnId, stepId, on }); if (r.error) return toast(r.error);
  toast(on ? '已收藏（收藏和專案記憶分開，不會自動傳給 AI）' : '已取消收藏');
}

/* ---------- 匿名比較 ---------- */
let anon = null;
export function openAnon(t) {
  const rounds = [...new Set(t.steps.filter(s => s.kind === 'answer' && s.status === 'ok' && !s.superseded).map(s => s.round))].sort((a, b) => a - b);
  const r = rounds.at(-1), pool = t.steps.filter(s => s.kind === 'answer' && s.round === r && s.status === 'ok' && !s.superseded);
  if (pool.length < 2) return toast('這一輪至少要有兩個成功的回答');
  anon = { t, r, order: pool.map(s => s.id).sort(() => Math.random() - 0.5), picked: null };
  renderAnon(); $('#dlgAnon').showModal();
}
async function renderAnon(stats) {
  const { t, r, order, picked } = anon, L = 'ABCDEFGH';
  const step = id => t.steps.find(s => s.id === id);
  if (!stats) stats = (await api('/api/prefs/stats', {})).stats;
  $('#anonBody').innerHTML = `<div class="small">第 ${r} 輪的回答已隱藏 AI 名稱並打亂順序。先選出對你最有幫助的一則，選完才會揭曉來源。這只記錄你的個人偏好，不是正確率，也不代表某家 AI 客觀比較好。</div>
    ${picked ? '' : `<div class="row2"><span class="small">任務類型：</span><input class="field" id="anonTask" value="${esc((t.brief && t.brief.template) || '一般')}" style="max-width:160px"></div>`}
    ${order.map((id, i) => `<div class="anon-card ${picked === id ? 'win' : ''}"><b>回答 ${L[i]}</b>${picked ? `　<span class="small">${esc(ai(step(id).ai).name)}${picked === id ? ' · 你選的' : ''}</span>` : `　<button class="btn" data-pick="${id}">選這則</button>`}<div class="md">${md(step(id).text)}</div></div>`).join('')}
    ${stats.total ? `<label>你的偏好紀錄（共 ${stats.total} 次）</label>${Object.entries(stats.byTask).map(([task, m]) => `<div class="small">${esc(task)}：${Object.entries(m).map(([k, v]) => `${esc(ai(k).name)} 被選 ${v.chosen}／${v.seen} 次`).join('　')}</div>`).join('')}<button class="btn" id="anonClear" style="margin-top:6px">清除偏好紀錄</button>` : ''}`;
}
export function bindAnon() {
  $('#anonBody').onclick = async e => {
    if (e.target.dataset.pick) {
      const r = await api('/api/prefs/vote', { pid: S.pid, cid: S.cid, turnId: anon.t.id, round: anon.r, stepId: e.target.dataset.pick, task: $('#anonTask').value });
      if (r.error) return toast(r.error); anon.picked = e.target.dataset.pick; renderAnon(r.stats);
    }
    if (e.target.id === 'anonClear' && confirm('清除所有匿名比較的偏好紀錄？')) { const r = await api('/api/prefs/clear', {}); renderAnon(r.stats); }
  };
}

/* ---------- AI 設定：模型清單、能力、新增席位 ---------- */
const CAP = { yes: ['yes', '可'], direct: ['yes', '直接'], tool: ['yes', '用工具'], write: ['yes', '讀寫'], read: ['yes', '唯讀'], off: ['', '關閉'], no: ['no', '不支援'], unknown: ['', '未驗證'], manual: ['', '手動'], uncontrolled: ['no', '無法控制'] };
export function capsHtml(c) {
  if (!c) return '';
  const cell = (label, v) => { const [cls, t] = CAP[v] || ['', v]; return `<span class="${cls}">${label}：${t}</span>`; };
  return `<div class="caps">${cell('文字', c.text)}${cell('圖片', c.image)}${cell('搜尋', c.search)}${cell('檔案', c.files)}${cell('指令', c.exec)}</div>`;
}
export async function loadModels(id, input) {
  const r = await api('/api/models', { id }); if (r.error) return;
  const dl = document.getElementById('models-' + id); if (!dl) return;
  dl.innerHTML = r.models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  if (input && r.note) input.title = r.note;
}
export async function addSeat(after) {
  const provider = prompt('新增席位：要用哪一家？輸入 claude、codex、gemini 或 grok', 'claude'); if (!provider) return;
  const name = prompt('席位名稱', provider === 'codex' ? 'ChatGPT 第二席' : '第二席'); if (!name) return;
  const r = await api('/api/ais/add', { provider: provider.trim().toLowerCase(), name });
  if (r.error) return toast(r.error, 4000);
  S.D = { ...S.D, ...r }; toast('已新增席位，可以設定模型與角色'); after();
}
export async function deleteSeat(id, after) {
  if (!confirm(`刪除席位「${ai(id).name}」？`)) return;
  const r = await api('/api/ais/delete', { id }); if (r.error) return toast(r.error, 4000);
  S.D = { ...S.D, ...r }; S.pref.ids = (S.pref.ids || []).filter(x => x !== id); savePref(); after();
}

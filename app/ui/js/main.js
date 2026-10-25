import { $, S, api, esc, ai, toast, copy, savePref, when, secs, P, tokenParam, STATUS } from './core.js';
import { renderChat, chatMarkdown, texts, toggleExpand, rememberToggle, MODES } from './chat.js';
import { renderComposer, bindComposer, autosize, refreshCheck, req, lastPreview, renderHL, renderExtras } from './composer.js';
import { bindImages, addToQueue, renderQueueCount, openQueue, bindQueue, openSearch, bindSearch, renderTags, editTags, toggleFavorite, openAnon, bindAnon, addSeat } from './phase4.js';
import { bindTeam } from './team.js';
import { startI18n, tr } from './i18n.js';
import { openRelay, bindRelay, openMaterials, bindMaterials, openOutput, bindOutput, openFiles, bindFiles, openDiff, bindDiff, branchFrom } from './phase3.js';
import { openPreview, openAISettings, saveAI, openSetup, bindSetup, openData, bindData, bindProject, openBrief, bindBrief, openMem, bindMem, openAnalyze, bindAnalyze, bindMemList } from './dialogs.js';

startI18n(localStorage.lang || 'en');

/* ---------- 載入與更新 ---------- */
async function load() {
  const st = await api('/api/state');
  if (st.settings.lang !== localStorage.lang) { localStorage.lang = st.settings.lang; location.reload(); return; }   // 語言改了（或第一次開啟）就用新語言重新載入
  S.D = st;
  if (!P()) S.pid = st.projects[0] && st.projects[0].id;
  const p = P(); if (p && !p.chats.find(c => c.id === S.cid)) S.cid = p.chats[0] && p.chats[0].id;
  localStorage.pid = S.pid || ''; localStorage.cid = S.cid || '';
  renderSide(); renderComposer(); renderQueueCount(); lastKey = ''; await tick();
  if (!st.settings.setupDone && !shown) { shown = true; openSetup(); }
  else if ((st.privacy.legacyPlaintext || st.privacy.recovered || st.privacy.encryption === 'failed') && !noticed) { noticed = true; openData(); }
}
let lastKey = '', lastTeam = '', wasRunning = false, shown = false, noticed = false;

function renderSide() {
  $('#proj').innerHTML = S.D.projects.map(p => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const kw = $('#search').value.trim().toLowerCase(), list = ((P() || {}).chats || []).filter(c => !kw || (c.title || '').toLowerCase().includes(kw));
  $('#chats').innerHTML = list.map(c => `<li class="${c.id === S.cid ? 'on' : ''}" data-id="${c.id}">
      <span class="t" title="${c.branchOf ? '分支自「' + esc(c.branchOf.title) + '」' : ''}">${c.branchOf ? '↳ ' : ''}${esc(c.title)}${(c.tags || []).map(t => `<span class="tg">#${esc(t)}</span>`).join('')}</span><span class="d" title="${esc(STATUS[c.status] || '')}">${['partial', 'failed', 'interrupted'].includes(c.status) ? '⚠ ' : ''}${when(c.updated)}</span>
      <span class="acts"><button data-ren="${c.id}" title="重新命名">✎</button><button data-del="${c.id}" title="刪除">✕</button></span></li>`).join('')
    || `<li class="small" style="cursor:default">${kw ? '找不到符合的對話' : '還沒有對話'}</li>`;
}

async function tick() {
  if (!S.pid) return;
  const r = await api(`/api/chat?pid=${S.pid}&cid=${S.cid || ''}`);
  S.offset = r.now - Date.now(); S.run = r.run; S.chat = r.chat;
  const send = $('#send');
  send.classList.toggle('stop', !!S.run);
  send.innerHTML = S.run ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  send.title = S.run ? '中止討論' : '送出（Ctrl+Enter）';
  const here = S.run && S.run.pid === S.pid && S.run.cid === S.cid;
  $('#timer').dataset.since = S.run ? S.run.at : '';
  if (S.run && !here) $('#timer').dataset.other = '1'; else delete $('#timer').dataset.other;
  renderManual();
  if (wasRunning && !S.run) { notifyDone(); load(); }
  wasRunning = !!S.run;
  const key = JSON.stringify([S.chat, here && S.run, S.D.settings.ais]);
  if (key !== lastKey) { lastKey = key; renderChat(); renderTags(); }
  const tk = JSON.stringify([S.cid, S.chat && S.chat.team]);   // 換對話或分工改了，輸入區的分工標籤與送出檢查跟著更新
  if (tk !== lastTeam) { lastTeam = tk; renderExtras(); refreshCheck(); }
  clock();
}
function clock() {
  const now = Date.now() + S.offset;
  document.querySelectorAll('[data-since]').forEach(e => {
    const s = +e.dataset.since;
    if (e.id === 'timer') e.textContent = s ? (e.dataset.other ? '另一個對話正在討論中 · ' : '討論中 · ') + secs(now - s) : '';
    else e.textContent = s ? secs(now - s) : '';
  });
}
function notifyDone() {
  if (!document.hidden) return;
  document.title = tr('✓ 討論結束 · AI圓桌會議');
  if (window.Notification && Notification.permission === 'granted') new Notification(tr('AI圓桌會議：討論結束'), { body: S.chat ? S.chat.title : '' });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = tr('AI圓桌會議 · 山姆蛋實驗室'); });

// 手動貼上：綁定步驟編號；看的是別的對話時也會標示這是哪個對話的步驟
let manualStep = null;
function renderManual() {
  const m = S.run && S.run.manual && S.run.manual[0];
  $('#pend').hidden = !m;
  if (!m) { manualStep = null; return; }
  if (manualStep !== m.stepId) { manualStep = m.stepId; $('#pp').value = m.prompt; $('#paste').value = ''; }
  $('#who').textContent = ai(m.ai).name + (m.kind === 'summary' ? '（主持總結）' : `（第 ${m.round} 輪）`);
  const other = m.cid !== S.cid ? (P()?.chats.find(c => c.id === m.cid)?.title || '另一個對話') : '';
  $('#pendWhere').textContent = other ? `　這是「${other}」的步驟，回覆會存到那個對話。` : '';
}

/* ---------- 送出 ---------- */
async function sendQ() {
  if (S.run) { await api('/api/stop', {}); return tick(); }
  const q = $('#q').value.trim(); if (!q) return $('#q').focus();
  if (!S.pref.ids.length) return toast('請至少選一個 AI');
  if (lastPreview?.problem) { toast(lastPreview.problem.text, 4000); return openPreview(doSend); }
  doSend();
}
async function doSend() {
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  if (!S.cid) { S.cid = (await api('/api/chat/new', { pid: S.pid })).id; }
  const r = await api('/api/send', req());
  if (r.error) { toast(r.error, 4500); if (r.code === 'ack') openAISettings(); return; }
  $('#q').value = ''; S.pref.quote = null; S.pref.brief = null; S.pref.images = []; savePref(); renderExtras(); autosize(); await load();
  $('#log').scrollTop = $('#log').scrollHeight;
}

/* ---------- 對話動作 ---------- */
const turnOf = id => S.chat && S.chat.turns.find(t => t.id === id);
async function act(url, body) {
  const r = await api(url, { pid: S.pid, cid: S.cid, ...body });
  if (r.code === 'confirm') {
    if (!confirm(r.error + '\n\n確定要重新送出這些步驟嗎？')) return;
    return act(url, { ...body, resend: true });
  }
  if (r.error) return toast(r.error, 4000);
  await tick();
}
$('#log').onclick = async e => {
  const d = e.target.closest('[data-mem],[data-copysum],[data-more],[data-reask],[data-copytext],[data-exp],[data-mode],[data-retry],[data-retryall],[data-resum],[data-resume],[data-setup],[data-quote],[data-verify],[data-goto],[data-analyze],[data-iact],[data-outfile],[data-cmp],[data-branch],[data-gochat],[data-fav],[data-anon]');
  if (!d) { document.body.classList.remove('side'); return; }
  const ds = d.dataset;
  if (ds.mode) { S.pref.mode = ds.mode; savePref(); renderComposer(); $('#q').value = ds.ex; autosize(); return $('#q').focus(); }
  if (ds.copytext) return copy(texts[ds.copytext]);
  if (ds.exp) { toggleExpand(ds.exp); return renderChat(); }
  if (ds.setup !== undefined) return openSetup();
  if (ds.quote) { const t = turnOf(ds.turn), s = t.steps.find(x => x.id === ds.quote); return quoteIt(t, s, s.text); }
  if (ds.verify !== undefined) {
    const t = turnOf(ds.turn), c = t.analysis.claims[+ds.verify], analyst = (t.steps.find(x => x.kind === 'analysis' && !x.superseded) || {}).ai;
    const who = t.ids.find(i => i !== analyst) || t.ids[0];
    return quoteIt(t, { ai: analyst || who, round: null, id: '' }, c.claim, `@${ai(who).name} 請上網查證引用的主張是否正確，附上你實際讀取的來源網址，並說明來源是否支持這個主張。`);
  }
  if (ds.goto) {
    const el = document.getElementById('step-' + ds.goto); if (!el) return toast('原文不在這個對話裡');
    el.closest('details')?.setAttribute('open', ''); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate([{ outline: '3px solid var(--gold)' }, { outline: '3px solid transparent' }], { duration: 1600 }); return;
  }
  if (ds.analyze) return openAnalyze(turnOf(ds.analyze));
  if (ds.fav) { const st = turnOf(ds.turn).steps.find(x => x.id === ds.fav); await toggleFavorite(ds.turn, ds.fav, !st.favorite); return tick(); }
  if (ds.anon) return openAnon(turnOf(ds.anon));
  if (ds.outfile) return openOutput(turnOf(ds.outfile));
  if (ds.cmp) return openDiff();
  if (ds.branch) return branchFrom(turnOf(ds.branch), load);
  if (ds.gochat) { S.cid = ds.gochat; return load(); }
  if (ds.iact) {
    const box = d.closest('[data-intervene]');
    return act('/api/turn/intervene', { turnId: box.dataset.intervene, action: ds.iact, note: box.querySelector('[data-inote]').value, skip: [...box.querySelectorAll('[data-iskip]:checked')].map(x => x.dataset.iskip) });
  }
  if (ds.retry) return act('/api/turn/retry', { turnId: ds.turn, stepIds: [ds.retry] });
  if (ds.retryall) { const t = turnOf(ds.retryall); return act('/api/turn/retry', { turnId: t.id, stepIds: t.steps.filter(s => !s.superseded && !s.userSkipped && s.kind === 'answer' && ['error', 'stopped', 'skipped'].includes(s.status)).map(s => s.id) }); }
  if (ds.resum) return act('/api/turn/retry', { turnId: ds.resum, summary: true });
  if (ds.resume) return act('/api/turn/resume', { turnId: ds.resume });
  if (ds.more) return act('/api/turn/more', { turnId: ds.more });
  const t = turnOf(ds.mem || ds.copysum || ds.reask);
  if (ds.mem) { const sum = t.steps.filter(x => x.kind === 'summary' && x.status === 'ok' && !x.superseded).pop(); return openMem(t.summary, { cid: S.cid, turnId: t.id, ai: sum ? sum.ai : t.ids[0] }); }
  if (ds.copysum) return copy(t.summary, '已複製結論');
  if (ds.reask) { $('#q').value = t.q; autosize(); return $('#q').focus(); }
};
$('#log').addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.k; if (k) rememberToggle(k, e.target.open); }, true);
$('#copyp').onclick = () => copy($('#pp').value, '已複製提示');
$('#sendp').onclick = async () => {
  if (!manualStep) return;
  const r = await api('/api/manual', { stepId: manualStep, text: $('#paste').value });
  if (r.error) return toast(r.error, 4000);
  $('#paste').value = ''; tick();
};

// 引用追問：把原文帶進輸入框上方；只有這次勾選或 @ 點名的 AI 會收到
function quoteIt(t, s, text, q) {
  S.pref.quote = { text: String(text).slice(0, 4000), ai: s.ai, round: s.round, turnId: t.id, stepId: s.id || '' }; savePref(); renderExtras();
  if (q) $('#q').value = q;
  autosize(); $('#q').focus(); toast('已引用，輸入追問後送出；用 @ 點名可以只問特定 AI', 3000);
}
// 選取回答裡的文字：浮出「引用追問」與「請 X 查證」
document.addEventListener('mouseup', e => {
  const bar = $('#selbar'); if (bar.contains(e.target)) return;
  setTimeout(() => {
    const sel = getSelection(), txt = (sel.rangeCount ? sel.getRangeAt(0).toString() : '').trim(), card = sel.anchorNode && sel.anchorNode.parentElement?.closest('.card[data-step]');
    if (!txt || !card || txt.length < 4) { bar.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect(), others = Object.keys(S.D.settings.ais).filter(k => k !== card.dataset.ai);
    bar.innerHTML = '<button class="btn" data-sq>引用追問</button>' + others.map(k => `<button class="btn" data-sv="${k}">請 ${esc(ai(k).name)} 查證</button>`).join('');
    bar.style.left = Math.max(8, Math.min(innerWidth - 430, r.left)) + 'px'; bar.style.top = Math.max(8, r.top - 50) + 'px'; bar.hidden = false;
    bar.onclick = ev => {
      const b = ev.target.closest('button'); if (!b) return;
      const t = turnOf(card.dataset.turn), s = t.steps.find(x => x.id === card.dataset.step);
      quoteIt(t, s, txt, b.dataset.sv ? `@${ai(b.dataset.sv).name} 請查證引用的這一段是否正確，必要時上網查詢並附上實際讀取的來源。` : undefined);
      bar.hidden = true; sel.removeAllRanges();
    };
  }, 10);
});

/* ---------- 側欄與標題 ---------- */
$('#proj').onchange = e => { S.pid = e.target.value; S.cid = null; load(); };
$('#search').oninput = renderSide;
$('#newc').onclick = async () => { S.cid = (await api('/api/chat/new', { pid: S.pid })).id; document.body.classList.remove('side'); await load(); $('#q').focus(); };
$('#newp').onclick = async () => { const n = prompt('新專案名稱'); if (n) { S.pid = (await api('/api/project/new', { name: n })).id; S.cid = null; load(); } };
$('#chats').onclick = async e => {
  const { del, ren } = e.target.dataset;
  if (del) { if (confirm('刪除這個對話？')) { const r = await api('/api/chat/delete', { pid: S.pid, cid: del }); if (r.error) return toast(r.error); if (del === S.cid) S.cid = null; load(); } return; }
  if (ren) return renameChat(ren);
  const li = e.target.closest('li[data-id]'); if (li) { S.cid = li.dataset.id; document.body.classList.remove('side'); load(); }
};
async function renameChat(id) {
  const c = (P().chats || []).find(x => x.id === id), n = prompt('對話名稱', c ? c.title : '');
  if (n && n.trim()) { await api('/api/chat/rename', { pid: S.pid, cid: id, title: n }); load(); }
}
$('#rename').onclick = () => S.cid && renameChat(S.cid);
$('#title').ondblclick = () => S.cid && renameChat(S.cid);
$('#export').onclick = () => {
  if (!S.chat || !S.chat.turns.length) return toast('這個對話還沒有內容');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([chatMarkdown()], { type: 'text/markdown' }));
  a.download = S.chat.title.replace(/[\\/:*?"<>|]/g, '_') + '.md'; a.click();
};
$('#copyall').onclick = () => copy(chatMarkdown(), '已複製整段對話');
$('#files').onclick = () => openFiles();
$('#menu').onclick = () => document.body.classList.toggle('side');

/* ---------- 對話框 ---------- */
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('#aiset').onclick = openAISettings;
$('#saveai').onclick = () => saveAI(true);
$('#aicheck').onclick = () => { $('#dlgAI').close(); openSetup(); };
$('#dataset').onclick = openData;
bindSetup(load); bindData(load); bindProject(load); bindBrief(() => { renderExtras(); refreshCheck(); }); bindMem(load); bindAnalyze(tick); bindMemList(load);
bindComposer({ onSend: sendQ, onPreview: () => openPreview(doSend), openAI: openAISettings, openBrief, openRelay, openMaterials });
bindRelay(); bindMaterials(); bindOutput(tick); bindFiles(); bindDiff(load); bindTeam(load);
bindImages(); bindQueue(load); bindSearch(load); bindAnon();
$('#queuebtn').onclick = () => addToQueue(load);
$('#queueset').onclick = async () => { await load(); openQueue(); };
$('#advsearch').onclick = openSearch;
$('#tagbtn').onclick = () => editTags().then(load);
$('#aiform').insertAdjacentHTML('afterend', '<button class="btn" id="addseat" style="margin-top:10px">＋ 新增 AI 席位（同一家用不同模型或角色）</button>');
$('#addseat').onclick = () => addSeat(() => { openAISettings(); renderComposer(); });

/* ---------- 深淺色 ---------- */
function applyTheme() { document.documentElement.dataset.theme = localStorage.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
// 語言：介面與送給 AI 的提示一起切換；改完重新載入，進行中的討論不受影響
const LANG_NAME = { en: 'English', 'zh-TW': '中文' };
const setLang = async lang => { await api('/api/settings', { lang }); localStorage.lang = lang; location.reload(); };
$('#langname').textContent = localStorage.lang === 'zh-TW' ? LANG_NAME.en : LANG_NAME['zh-TW'];
$('#langbtn').onclick = () => setLang(localStorage.lang === 'zh-TW' ? 'en' : 'zh-TW');
document.querySelectorAll('[data-lang]').forEach(b => { b.classList.toggle('gold', b.dataset.lang === (localStorage.lang || 'en')); b.onclick = () => b.dataset.lang !== localStorage.lang && setLang(b.dataset.lang); });
$('#theme').onclick = () => { localStorage.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); };
applyTheme();

addEventListener('pagehide', () => navigator.sendBeacon('/api/bye?' + tokenParam(), '{}'));
// 程式關閉或連不到時只提示一次，不在背景一直報錯；連回來後自動恢復
let offline = false;
const safe = fn => () => fn().then(() => { if (offline) { offline = false; toast('已重新連上 AI圓桌會議'); } }).catch(() => { if (!offline) { offline = true; toast('連不到 AI圓桌會議，程式可能已經關閉。重新開啟後這個視窗會自動恢復', 6000); } });
safe(load)(); setInterval(safe(tick), 1500); setInterval(clock, 1000);

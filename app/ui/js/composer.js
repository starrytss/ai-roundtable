// 輸入區：選 AI、模式、主持人，送出前一定看得到「會傳給誰、預計幾次呼叫」
import { $, S, api, esc, ai, av, col, toast, savePref, badge, P } from './core.js';

const keys = () => Object.keys(S.D.settings.ais);
// @Claude、@ChatGPT：只傳給被點名的 AI（這次提問暫時取代上方勾選）
export function mentioned(q = $('#q').value) {
  const ais = S.D.settings.ais, out = [];
  for (const m of String(q).matchAll(/@([^\s@，。、,:：！？!?]+)/g)) {
    const k = Object.keys(ais).find(id => id.toLowerCase() === m[1].toLowerCase() || (ais[id].name || '').toLowerCase() === m[1].toLowerCase());
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}
export function req(extra = {}) {
  const p = S.pref, relay = $('#mode').value === 'relay', men = relay ? [] : mentioned(), ids = relay ? [...new Set((p.stages || []).map(x => x.ai))] : men.length ? men : p.ids;
  const mod = men.length ? (men.includes(p.mod) ? p.mod : men[0]) : $('#mod').value;
  return { pid: S.pid, cid: S.cid, q: $('#q').value.trim(), ids, mode: $('#mode').value, rounds: +$('#rounds').value, mod,
    modOutside: men.length ? false : !!p.modOutside, include: p.include || {}, redact: p.redact ?? S.D.settings.privacy.redact,
    pause: !!p.pause, quote: p.quote || null, brief: p.brief || null,
    stages: relay ? p.stages || [] : undefined, review: p.review !== false, outputTemplate: p.outputTemplate || '', materials: p.materials || null, ...extra };
}

export function renderComposer() {
  const ks = keys(), p = S.pref;
  if (!p.ids) p.ids = ks.filter(k => ai(k).mode === 'auto' && !ai(k).needsAck);
  p.ids = p.ids.filter(k => ks.includes(k));
  $('#ais').innerHTML = ks.map(k => {
    const a = ai(k), tag = a.mode !== 'auto' ? '<small>手動</small>' : a.needsAck ? '<small style="color:var(--danger)">需確認</small>' : '';
    return `<button class="aichip" style="--c:${col(k)}" data-ai="${k}" aria-pressed="${p.ids.includes(k)}">${av(k)}${esc(a.name)}${tag}</button>`;
  }).join(' ');
  const inside = ks.filter(k => p.ids.includes(k)), outside = ks.filter(k => !p.ids.includes(k));
  if (!p.mod || (!p.ids.includes(p.mod) && !p.modOutside)) p.mod = inside[0] || ks[0];
  $('#mod').innerHTML = inside.map(k => `<option value="${k}">${esc(ai(k).name)}</option>`).join('')
    + (outside.length ? `<optgroup label="未勾選（仍會收到問題與最後一輪回答）">${outside.map(k => `<option value="${k}">${esc(ai(k).name)}（未參與）</option>`).join('')}</optgroup>` : '');
  $('#mod').value = p.mod;
  $('#mode').value = p.mode || 'discuss'; $('#rounds').value = p.rounds || '2';
  const relay = $('#mode').value === 'relay', solo = !relay && p.ids.length < 2;
  $('#rounds').disabled = $('#mod').disabled = solo || relay; $('#mode').disabled = solo && !relay;
  $('#rounds').hidden = $('#mod').hidden = $('#mod').previousElementSibling.hidden = relay;
  $('#pause').checked = !!p.pause; $('#pausewrap').hidden = solo || relay; $('#relaybtn').hidden = !relay;
  $('#outtpl').innerHTML = '<option value="">成果：不指定</option>' + (S.D.outputTemplates || []).map(t => `<option value="${t.key}">成果：${esc(t.name)}</option>`).join('');
  $('#outtpl').value = p.outputTemplate || '';
  renderExtras(); refreshCheck();
}

// 輸入框上方的附加項目：引用的內容、任務簡報
export function renderExtras() {
  const p = S.pref, chips = [];
  if (p.quote) chips.push(`<span class="skchip url" title="${esc(p.quote.text)}"><span class="ic">❝</span><b>引用 ${esc(ai(p.quote.ai).name)}${p.quote.round ? ` 第 ${p.quote.round} 輪` : ''}</b><small>${esc(p.quote.text.slice(0, 40))}${p.quote.text.length > 40 ? '…' : ''}</small><button data-rmquote title="移除引用">✕</button></span>`);
  if ($('#mode').value === 'relay') {
    const st = p.stages || [];
    chips.push(`<span class="skchip"><b>🏃 分工接力</b><small>${st.length ? st.map((x, i) => `${i + 1}. ${esc(x.role)}（${esc(ai(x.ai).name)}）`).join(' → ') : '還沒設定棒次'}${p.review !== false ? '　·　每棒驗收' : ''}</small><button data-editrelay title="編輯">✎</button></span>`);
  }
  const mats = (P() || {}).materials || [], chosen = p.materials ? mats.filter(m => p.materials.includes(m.id)) : mats.filter(m => m.auto !== false);
  if (chosen.length) chips.push(`<span class="skchip"><b>📎 共用資料 ${chosen.length} 份</b><small>${chosen.map(m => esc(m.title)).slice(0, 3).join('、')}${chosen.length > 3 ? '…' : ''}${p.materials ? '（這次自選）' : ''}</small><button data-editmat title="選擇">✎</button></span>`);
  if (p.brief) {
    const F = S.D.briefFields || [], filled = F.filter(([k]) => String(p.brief.fields[k] || '').trim()).length, miss = F.filter(([k]) => !String(p.brief.fields[k] || '').trim() && (p.brief.ask || []).includes(k));
    chips.push(`<span class="skchip"><b>📋 ${esc(p.brief.template || '任務簡報')}</b><small>已填 ${filled} 項${miss.length ? `　·　缺：${miss.map(([, l]) => esc(l)).join('、')}` : ''}</small><button data-editbrief title="編輯">✎</button><button data-rmbrief title="移除簡報">✕</button></span>`);
  }
  $('#extras').innerHTML = chips.join('');
}

// 送出前檢查列：參與者、主持人、預計呼叫次數、問題（例如主持人未勾選、需要確認）
let pvTimer = null, pvSeq = 0;
export function refreshCheck() { clearTimeout(pvTimer); pvTimer = setTimeout(doCheck, 250); }
export let lastPreview = null;
async function doCheck() {
  const box = $('#check'), r = req({ q: $('#q').value.trim() || '（預覽）' }), seq = ++pvSeq;
  if (!S.pid || !r.ids.length) { box.innerHTML = '<span class="warn">請至少選一個 AI</span>'; lastPreview = null; return; }
  const pv = await api('/api/preview', r); if (seq !== pvSeq) return;
  if (pv.error) { box.innerHTML = `<span class="warn">${esc(pv.error)}</span>`; lastPreview = null; return; }
  lastPreview = pv;
  const people = pv.recipients.map(x => `<span class="rcp">${av(x.ai)}<b>${esc(x.name)}</b>${x.outside ? '<span class="mtag">只主持</span>' : ''}${badge(x.guarantee)}</span>`).join('');
  const e = pv.estimate, men = mentioned();
  let h = `<span>${men.length ? '只傳給（@點名）：' : '傳送給：'}</span>${people}<span>· 預計 <b>${e.total}</b> 次 CLI 呼叫${e.manual ? `（其中手動貼上 ${e.manual} 次）` : ''}</span>`
    + `<span class="lnk" data-preview>查看傳送內容</span>`;
  h += `<span class="mtag">${usageText(pv.recipients.filter(x => x.mode === 'auto').map(x => x.ai))}</span>`;
  if (pv.redact) h += '<span class="mtag">送出前遮蔽敏感資訊：開啟</span>';
  if (pv.recipients.some(x => x.argvPrompt)) h += '<span class="warn">注意：有 AI 只能把提示放在命令列參數，電腦上的其他程式可能看得到。</span>';
  if (pv.problem) {
    h += `<span class="warn">${esc(pv.problem.text)}`;
    if (pv.problem.code === 'moderator') h += `<br><button class="btn" data-fixmod="in">改由已勾選的 AI 主持</button><button class="btn" data-fixmod="out">我了解，仍讓 ${esc(ai(pv.moderator).name)} 主持</button>`;
    if (pv.problem.code === 'ack') h += `<br><button class="btn" data-openai>到 AI 設定閱讀並確認</button>`;
    h += '</span>';
  } else if (pv.modOutside) h += `<span class="warn">${esc(ai(pv.moderator).name)} 沒有參與討論，但會收到問題與最後一輪的回答來整理結論。<button class="btn" data-fixmod="in">改由已勾選的 AI 主持</button></span>`;
  box.innerHTML = h;
}

// 用量：只顯示 CLI 自己回報的資訊（目前只有 Claude Code 會回報 5 小時用量比例），其他標示未知
export function usageText(ids) {
  const u = S.D.settings.usage || {};
  return ids.map(id => {
    const r = u[id]?.rateLimit, w = r?.unifiedWindows?.[r.rateLimitType] || r;
    if (w && typeof w.utilization === 'number') return `${esc(ai(id).name)} 用量約 ${Math.round(w.utilization * 100)}%（CLI 回報，${new Date(u[id].at).toLocaleTimeString().slice(0, 5)}）`;
    return `${esc(ai(id).name)} 用量：未知`;
  }).join('　');
}

export function bindComposer({ onSend, onPreview, openAI, openBrief, openRelay, openMaterials }) {
  $('#pause').onchange = e => { S.pref.pause = e.target.checked; savePref(); };
  $('#briefbtn').onclick = openBrief;
  $('#extras').onclick = e => {
    if (e.target.closest('[data-rmquote]')) { S.pref.quote = null; savePref(); renderExtras(); return refreshCheck(); }
    if (e.target.closest('[data-rmbrief]')) { S.pref.brief = null; savePref(); renderExtras(); return refreshCheck(); }
    if (e.target.closest('[data-editbrief]')) return openBrief();
    if (e.target.closest('[data-editrelay]')) return openRelay();
    if (e.target.closest('[data-editmat]')) return openMaterials();
  };
  $('#outtpl').onchange = e => { S.pref.outputTemplate = e.target.value; savePref(); refreshCheck(); };
  $('#relaybtn').onclick = () => openRelay();
  $('#matbtn').onclick = () => openMaterials();
  $('#ais').onclick = e => {
    const b = e.target.closest('[data-ai]'); if (!b) return;
    const k = b.dataset.ai, p = S.pref;
    p.ids = p.ids.includes(k) ? p.ids.filter(x => x !== k) : [...p.ids, k];
    if (!p.ids.includes(p.mod) && !p.modOutside) p.mod = p.ids[0];
    savePref(); renderComposer(); renderHL();
  };
  $('#mode').onchange = e => { S.pref.mode = e.target.value; savePref(); renderComposer(); if (e.target.value === 'relay' && !(S.pref.stages || []).length) openRelay(); };
  $('#rounds').onchange = e => { S.pref.rounds = e.target.value; savePref(); refreshCheck(); };
  $('#mod').onchange = e => { S.pref.mod = e.target.value; S.pref.modOutside = !S.pref.ids.includes(e.target.value); savePref(); refreshCheck(); };
  $('#check').onclick = e => {
    if (e.target.closest('[data-preview]')) return onPreview();
    if (e.target.closest('[data-openai]')) return openAI();
    const f = e.target.closest('[data-fixmod]'); if (!f) return;
    if (f.dataset.fixmod === 'in') { S.pref.mod = S.pref.ids[0]; S.pref.modOutside = false; } else S.pref.modOutside = true;
    savePref(); renderComposer();
  };
  $('#send').onclick = onSend;
  $('#q').addEventListener('input', () => { autosize(); showSk(false); });
  $('#q').addEventListener('scroll', () => { $('#qhl').scrollTop = $('#q').scrollTop; });
  $('#q').addEventListener('blur', () => setTimeout(hideSk, 150));
  $('#q').onkeydown = e => {
    if (!$('#skpop').hidden && skItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); skIdx = (skIdx + 1) % skItems.length; return renderSk(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); skIdx = (skIdx - 1 + skItems.length) % skItems.length; return renderSk(); }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); return chooseSk(skIdx); }
    }
    if (e.key === 'Escape') return hideSk();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); hideSk(); onSend(); }
  };
  $('#skpop').addEventListener('mousedown', async e => {
    e.preventDefault();
    if (e.target.closest('[data-skref]')) { await loadSkills(true); return showSk(true); }
    const it = e.target.closest('[data-ski]'); if (it) chooseSk(+it.dataset.ski);
  });
  $('#skbtn').onclick = async () => { if (!$('#skpop').hidden) return hideSk(); await loadSkills(); $('#q').focus(); showSk(true); };
  $('#skchips').onclick = e => {
    const q = $('#q'), u = e.target.dataset.rmurl, n = e.target.dataset.rmsk;
    if (u) { q.value = q.value.split(u).join('').replace(/  +/g, ' '); autosize(); return q.focus(); }
    if (!n) return;
    q.value = q.value.replace(new RegExp('\\$' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])\\s?', 'gi'), ''); autosize(); q.focus();
  };
  loadSkills().then(renderHL);
}

export function autosize() { const q = $('#q'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 240) + 'px'; renderHL(); refreshCheck(); }

/* ---------- 技能：輸入框標示與選單（沿用 v1.0，轉述預設關閉）---------- */
let SK = [], skItems = [], skIdx = 0;
const SKRE = /\$([A-Za-z0-9][\w.-]*)|(https?:\/\/[^\s<>"'）)\]】」，。、]+)/g;
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const findSk = n => SK.filter(x => x.name.toLowerCase() === n.replace(/[.]+$/, '').toLowerCase());
async function loadSkills(refresh) { try { SK = await api('/api/skills' + (refresh ? '?refresh=1' : '')); } catch { SK = []; } }
export function renderHL() {
  const v = $('#q').value; let html = '', last = 0; const found = new Map(), bad = new Set(), urls = new Set();
  for (const m of v.matchAll(SKRE)) {
    if (m[2]) { urls.add(m[2]); html += esc(v.slice(last, m.index)) + `<span class="hl-url">${esc(m[0])}</span>`; last = m.index + m[0].length; continue; }
    const own = findSk(m[1]), ok = own.length > 0, cls = ok ? 'hl-ok' : (SK.length ? 'hl-bad' : '');
    if (ok) found.set(own[0].name, own); else if (SK.length) bad.add(m[1]);
    html += esc(v.slice(last, m.index)) + (cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0])); last = m.index + m[0].length;
  }
  $('#qhl').innerHTML = html + esc(v.slice(last)) + '\n';
  $('#qhl').scrollTop = $('#q').scrollTop;
  const sel = S.pref.ids || [], relayOn = !!(S.pref.include || {}).skills;
  $('#skchips').innerHTML = [...found].map(([n, own]) => {
    const owners = own.map(x => x.ai), use = sel.filter(i => owners.includes(i)), relay = sel.filter(i => !owners.includes(i));
    const note = [use.length ? `${use.map(i => esc(ai(i).name)).join('、')} 直接使用` : '', relay.length ? (relayOn ? `會轉述技能內容給 ${relay.map(i => esc(ai(i).name)).join('、')}` : `技能轉述未開啟，${relay.map(i => esc(ai(i).name)).join('、')} 不會收到技能內容`) : ''].filter(Boolean).join('　·　');
    return `<span class="skchip" title="${esc(own[0].desc)}">${av(own[0].ai)}<b>⚡ $${esc(n)}</b><small>${note || '已讀入'}</small><button data-rmsk="${esc(n)}" title="移除">✕</button></span>`;
  }).join('') + [...bad].map(n => `<span class="skchip bad"><b>$${esc(n)}</b><small>找不到這個技能</small></span>`).join('')
    + [...urls].map(u => `<span class="skchip url" title="${esc(u)}"><span class="ic">↗</span><b>${esc(host(u))}</b><small>可上網的 AI 會讀取這個網頁</small><button data-rmurl="${esc(u)}" title="移除">✕</button></span>`).join('');
}
function skToken() { const q = $('#q'), pos = q.selectionStart, m = q.value.slice(0, pos).match(/(^|\s)([\/$])([^\s\/$]*)$/); return m ? { start: pos - m[3].length - 1, end: pos, kw: m[3].toLowerCase() } : null; }
function showSk(force) { const t = skToken(); if (!t && !force) return hideSk(); const kw = t ? t.kw : ''; skItems = SK.filter(x => !kw || x.name.toLowerCase().includes(kw) || x.desc.toLowerCase().includes(kw)).slice(0, 80); skIdx = 0; renderSk(); }
function renderSk() {
  const box = $('#skpop'); box.hidden = false;
  const head = `<div class="sh"><span>已安裝的技能 · ${SK.length}</span><button data-skref>重新掃描</button></div>`;
  if (!skItems.length) { box.innerHTML = head + `<div class="sk-empty">${SK.length ? '找不到符合的技能。' : '沒有找到任何技能。<br>會掃描 ChatGPT 的 <code>.codex\\skills</code>、Claude 的 <code>.claude\\skills</code> 等資料夾。'}</div>`; return; }
  box.innerHTML = head + skItems.map((x, i) => `<div class="sk-i ${i === skIdx ? 'on' : ''}" data-ski="${i}">${av(x.ai)}<div><b>$${esc(x.name)}</b>${x.system ? '<span class="tag">內建</span>' : ''}<small>${esc(x.desc || '（沒有說明）')}</small></div></div>`).join('');
  box.querySelector('.sk-i.on')?.scrollIntoView({ block: 'nearest' });
}
function hideSk() { $('#skpop').hidden = true; skItems = []; }
function chooseSk(i) {
  const x = skItems[i]; if (!x) return;
  const q = $('#q'), t = skToken(), ins = '$' + x.name + ' ', a = t ? t.start : q.selectionStart, b = t ? t.end : q.selectionEnd;
  q.value = q.value.slice(0, a) + ins + q.value.slice(b); q.selectionStart = q.selectionEnd = a + ins.length; hideSk(); q.focus(); autosize();
  if (!S.pref.ids.includes(x.ai)) toast(`這是 ${ai(x.ai).name} 的技能。其他 AI 只有在「查看傳送內容」開啟技能轉述時才會收到內容`, 3500);
}

// 第三階段：分工接力設定、共用資料區、成果檔、檔案面板、版本比較與採納紀錄、討論分支
import { $, S, api, esc, ai, av, toast, savePref, P, when } from './core.js';
import { renderExtras, refreshCheck } from './composer.js';
import { md } from './md.js';

const INPUT = { previous: '交接上一棒的產出', all: '交接前面所有棒次', question: '只看問題（不交接）' };
const aiOptions = sel => Object.keys(S.D.settings.ais).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(ai(k).name)}</option>`).join('');

/* ---------- 分工接力 ---------- */
let draft = [];
export function openRelay() {
  draft = JSON.parse(JSON.stringify(S.pref.stages && S.pref.stages.length ? S.pref.stages : (S.D.settings.relayTemplates[0] || { stages: [] }).stages));
  renderRelay();
  if (!$('#dlgRelay').open) $('#dlgRelay').showModal();
}
function renderRelay() {
  const tpls = S.D.settings.relayTemplates || [];
  $('#relayBody').innerHTML = `<div class="small">每一棒有自己的職務、負責的 AI、任務與驗收條件，只交接需要的內容。一棒接一棒依序執行，不會有兩位 AI 同時修改同一份檔案。同一家 AI 可以擔任不同職務。</div>
    <div class="row2"><select class="field" id="relayTpl"><option value="">套用團隊範本…</option>${tpls.map(t => `<option>${esc(t.name)}</option>`).join('')}</select><button class="btn" id="relayDel">刪除範本</button></div>
    ${draft.map((x, i) => `<div class="stage-row" data-i="${i}"><div class="row2"><span class="stage-no">第 ${i + 1} 棒</span><input class="field" data-k="role" value="${esc(x.role)}" placeholder="職務，例如：資料研究"><select class="field" data-k="ai">${aiOptions(x.ai)}</select>
      <button class="btn" data-up ${i ? '' : 'disabled'}>↑</button><button class="btn" data-rm>刪除</button></div>
      <textarea class="field" data-k="task" rows="2" style="width:100%" placeholder="這一棒要做什麼">${esc(x.task)}</textarea>
      <div class="row2"><input class="field" data-k="accept" value="${esc(x.accept)}" placeholder="驗收條件，例如：每個數字都有來源"><select class="field" data-k="input">${Object.entries(INPUT).map(([k, l]) => `<option value="${k}" ${x.input === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`).join('')}
    <div class="row2"><button class="btn" id="relayAdd" ${draft.length >= 8 ? 'disabled' : ''}>＋ 新增一棒</button><label class="sk"><input type="checkbox" id="relayReview" ${S.pref.review !== false ? 'checked' : ''}> 每一棒完成後讓我驗收（可以退回修改）</label></div>
    <div class="small">送出前「查看傳送內容」會列出每一棒會收到什麼；需要確認權限的 AI 仍要先在 AI 設定確認。</div>`;
}
function readRelay() {
  document.querySelectorAll('#relayBody .stage-row').forEach(row => { const x = draft[+row.dataset.i]; row.querySelectorAll('[data-k]').forEach(el => { x[el.dataset.k] = el.value; }); });
}
export function bindRelay() {
  $('#relayBody').onclick = e => {
    const row = e.target.closest('.stage-row'); readRelay();
    if (e.target.id === 'relayAdd') { draft.push({ role: '', ai: Object.keys(S.D.settings.ais)[0], task: '', accept: '', input: 'previous' }); return renderRelay(); }
    if (e.target.id === 'relayDel') { const n = $('#relayTpl').value; if (!n || !confirm(`刪除範本「${n}」？`)) return; return api('/api/relay/delete', { name: n }).then(r => { S.D.settings.relayTemplates = r.relayTemplates; renderRelay(); }); }
    if (!row) return; const i = +row.dataset.i;
    if (e.target.matches('[data-rm]')) { draft.splice(i, 1); renderRelay(); }
    if (e.target.matches('[data-up]') && i) { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; renderRelay(); }
  };
  $('#relayBody').onchange = e => { if (e.target.id === 'relayTpl') { const t = S.D.settings.relayTemplates.find(x => x.name === e.target.value); if (t) { draft = JSON.parse(JSON.stringify(t.stages)); renderRelay(); } } };
  $('#relayUse').onclick = () => {
    readRelay();
    if (!draft.length) return toast('至少需要一棒');
    if (draft.some(x => !x.role.trim())) return toast('每一棒都要填職務');
    S.pref.stages = draft; S.pref.review = $('#relayReview').checked; S.pref.mode = 'relay'; savePref();
    $('#dlgRelay').close(); $('#mode').value = 'relay'; renderExtras(); refreshCheck();
  };
  $('#relaySave').onclick = async () => {
    readRelay(); const n = prompt('團隊範本名稱', $('#relayTpl').value || ''); if (!n) return;
    const r = await api('/api/relay/save', { name: n, stages: draft }); if (r.error) return toast(r.error);
    S.D.settings.relayTemplates = r.relayTemplates; toast('已儲存團隊範本'); renderRelay();
  };
}

/* ---------- 共用資料區 ---------- */
export function openMaterials() { renderMat(); if (!$('#dlgMat').open) $('#dlgMat').showModal(); }
function renderMat() {
  const mats = (P() || {}).materials || [], sel = S.pref.materials, keys = Object.keys(S.D.settings.ais);
  const on = m => (sel ? sel.includes(m.id) : m.auto !== false);
  $('#matBody').innerHTML = `<div class="small">放進這裡的文件、網頁與參考資料，可以指定要分享給哪些 AI。文字內容會附在提示裡；分享給所有 AI 的檔案也會放進工作資料夾 materials/，讓有讀取權限的 AI 直接讀。這些內容都視為參考資料，不是指令。</div>
    <label>這個專案的資料</label>
    <div class="blist">${mats.map(m => `<div data-mid="${m.id}"><input type="checkbox" data-use ${on(m) ? 'checked' : ''} title="這次提問附上"><span class="grow"><b>${esc(m.title)}</b>　<span class="small">${{ text: '文字', url: '網址', file: '檔案' }[m.kind]}${m.kind === 'url' ? '：' + esc(m.url) : `：${(m.chars ?? (m.text || '').length).toLocaleString()} 字`}　分享給：${m.share === 'all' ? '所有 AI' : m.share.map(k => esc(ai(k).name)).join('、') || '沒有'}</span></span>
      <label class="sk"><input type="checkbox" data-auto ${m.auto !== false ? 'checked' : ''}> 預設附上</label><button class="btn" data-del>刪除</button></div>`).join('') || '<div>還沒有資料</div>'}</div>
    <label>新增資料</label>
    <div class="row2"><select class="field" id="matKind"><option value="text">貼上文字</option><option value="file">上傳文字檔</option><option value="url">網址</option></select><input class="field" id="matTitle" placeholder="標題"></div>
    <textarea class="field" id="matText" rows="4" style="width:100%" placeholder="貼上內容（最多 200,000 字）"></textarea>
    <input class="field" id="matUrl" placeholder="https://…" hidden style="width:100%"><input class="field" type="file" id="matFile" hidden accept=".txt,.md,.csv,.json,.html,.htm,.xml,.yml,.yaml,.log">
    <div class="row2"><span class="small">分享給：</span><label class="sk"><input type="radio" name="matShare" value="all" checked> 所有 AI</label>${keys.map(k => `<label class="sk"><input type="checkbox" data-share="${k}"> ${esc(ai(k).name)}</label>`).join('')}<button class="btn gold" id="matAdd">加入</button></div>`;
  $('#matFoot').textContent = sel ? '這次提問使用自選的資料' : '這次提問使用「預設附上」的資料';
  const kind = () => $('#matKind').value;
  $('#matKind').onchange = () => { $('#matText').hidden = kind() === 'url'; $('#matUrl').hidden = kind() !== 'url'; $('#matFile').hidden = kind() !== 'file'; };
}
export function bindMaterials() {
  $('#matBody').onclick = async e => {
    if (e.target.id === 'matAdd') {
      const kind = $('#matKind').value, f = $('#matFile').files[0];
      let text = $('#matText').value, fileName = '';
      if (kind === 'file') { if (!f) return toast('請選擇文字檔'); if (f.size > 2 * 1024 * 1024) return toast('檔案太大，請只放需要的部分'); text = await f.text(); fileName = f.name; }
      const picked = [...document.querySelectorAll('#matBody [data-share]:checked')].map(x => x.dataset.share);
      const share = picked.length ? picked : 'all';
      const r = await api('/api/materials/add', { pid: S.pid, kind, title: $('#matTitle').value || (f ? f.name : ''), text, url: $('#matUrl').value, fileName, share });
      if (r.error) return toast(r.error, 4000);
      P().materials = r.materials; renderMat(); renderExtras(); refreshCheck(); return toast('已加入');
    }
    const row = e.target.closest('[data-mid]'); if (!row) return;
    if (e.target.matches('[data-del]')) { if (!confirm('刪除這份資料？')) return; const r = await api('/api/materials/delete', { pid: S.pid, id: row.dataset.mid }); P().materials = r.materials; if (S.pref.materials) S.pref.materials = S.pref.materials.filter(x => x !== row.dataset.mid); savePref(); renderMat(); renderExtras(); refreshCheck(); }
  };
  $('#matBody').onchange = async e => {
    const row = e.target.closest('[data-mid]'); if (!row) return;
    if (e.target.matches('[data-auto]')) { const r = await api('/api/materials/update', { pid: S.pid, id: row.dataset.mid, auto: e.target.checked }); P().materials = r.materials; renderMat(); renderExtras(); refreshCheck(); }
  };
  $('#matUse').onclick = () => {
    const ids = [...document.querySelectorAll('#matBody [data-mid]')].filter(r => r.querySelector('[data-use]').checked).map(r => r.dataset.mid);
    const defaults = ((P() || {}).materials || []).filter(m => m.auto !== false).map(m => m.id);
    S.pref.materials = ids.length === defaults.length && ids.every(x => defaults.includes(x)) ? null : ids;
    savePref(); $('#dlgMat').close(); renderExtras(); refreshCheck();
  };
}

/* ---------- 產生成果檔 ---------- */
let outCtx = null;
export function openOutput(t) {
  outCtx = t;
  const hasTable = /^\s*\|.+\|\s*$/m.test(t.summary || '');
  $('#outBody').innerHTML = `<div class="small">本程式會把結論存進這個對話的工作資料夾 outputs/，同名的成果會變成新版本，不會覆蓋舊版。Word 或 PowerPoint 需要讓有寫入權限的 AI 自己產生，這裡只產生下列格式。</div>
    <label>檔名</label><input class="field" id="outName" value="${esc((t.q || '成果').slice(0, 30))}">
    <label>格式</label><select class="field" id="outFmt"><option value="md">Markdown（.md）</option><option value="html">網頁（.html，可用瀏覽器列印成 PDF）</option><option value="csv" ${hasTable ? '' : 'disabled'}>表格（.csv，Excel 可開啟）${hasTable ? '' : '：結論裡沒有表格'}</option></select>`;
  $('#dlgOut').showModal();
}
export function bindOutput(after) {
  $('#outGo').onclick = async () => {
    const r = await api('/api/outputs/save', { pid: S.pid, cid: S.cid, turnId: outCtx.id, format: $('#outFmt').value, name: $('#outName').value });
    if (r.error) return toast(r.error, 4000);
    $('#dlgOut').close(); toast(`已產生 ${r.output.path}`); after(); openFiles(r.output.path);
  };
}

/* ---------- 檔案面板 ---------- */
let F = null, cur = null;
export async function openFiles(focus) {
  if (!S.cid) return toast('請先開始一個對話');
  F = await api('/api/files/list', { pid: S.pid, cid: S.cid }); if (F.error) return toast(F.error);
  const src = f => f.output ? `成果 v${f.output.version}${f.output.template ? '（' + esc((S.D.outputTemplates.find(t => t.key === f.output.template) || {}).name || '') + '）' : ''}${f.output.from?.ai ? ' · ' + esc(ai(f.output.from.ai).name) : ''}`
    : f.writtenBy ? `${esc(ai(f.writtenBy.ai).name)} 寫入` : f.path.startsWith('materials/') ? '共用資料' : f.link ? '連結（不跟隨）' : '其他';
  $('#filesBody').innerHTML = `<div class="small">這個對話的工作資料夾：${esc(F.dir)}　AI 的實際存取範圍依各自的權限設定與 CLI 能力而定。</div>
    <div class="fgrid" style="margin-top:8px"><div class="blist" id="flist">${F.files.map(f => `<div data-path="${esc(f.path)}"><span class="grow">${esc(f.path)}</span><span class="small">${src(f)}</span></div>`).join('') || '<div>目前沒有檔案</div>'}</div>
    <div><div class="row2"><button class="btn" id="fDl" disabled>下載</button><button class="btn" id="fRestore" disabled>回到這個版本</button><button class="btn" id="fCmp">比較版本</button></div><div class="fprev" id="fprev"><span class="small">選擇左邊的檔案預覽</span></div></div></div>`;
  if (!$('#dlgFiles').open) $('#dlgFiles').showModal();
  if (focus) showFile(focus);
}
async function showFile(p) {
  cur = F.files.find(f => f.path === p); if (!cur) return;
  document.querySelectorAll('#flist [data-path]').forEach(d => d.classList.toggle('on', d.dataset.path === p));
  $('#fDl').disabled = !!cur.link; $('#fRestore').disabled = !cur.output;
  if (cur.link) { $('#fprev').innerHTML = '<span class="small">這是連結，為了安全不跟隨也不預覽。</span>'; return; }
  const r = await api('/api/files/read', { pid: S.pid, cid: S.cid, path: p });
  if (r.error) { $('#fprev').textContent = r.error; return; }
  $('#fprev').innerHTML = r.binary ? `<span class="small">不是文字檔（${Math.ceil(r.bytes / 1024)} KB），請下載或在檔案總管開啟。</span>`
    : (/\.md$/i.test(p) ? `<div class="md">${md(r.text)}</div>` : `<pre style="white-space:pre-wrap;margin:0">${esc(r.text)}</pre>`) + (r.truncated ? '<div class="small">（只顯示前 200,000 字）</div>' : '');
}
export function bindFiles() {
  $('#filesBody').onclick = async e => {
    const it = e.target.closest('#flist [data-path]'); if (it) return showFile(it.dataset.path);
    if (e.target.id === 'fDl' && cur) {
      const r = await api('/api/files/download', { pid: S.pid, cid: S.cid, path: cur.path }); if (r.error) return toast(r.error, 4000);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.file), c => c.charCodeAt(0))])); a.download = r.name; a.click();
    }
    if (e.target.id === 'fRestore' && cur?.output) { const r = await api('/api/outputs/restore', { pid: S.pid, cid: S.cid, outputId: cur.output.id }); if (r.error) return toast(r.error); toast(`已把 v${r.output.restoredFrom} 的內容存成 v${r.output.version}`); openFiles(r.output.path); }
    if (e.target.id === 'fCmp') { $('#dlgFiles').close(); openDiff(); }
  };
}

/* ---------- 版本比較與採納紀錄 ---------- */
function versions() {
  const out = [], chat = S.chat; if (!chat) return out;
  for (const o of F?.outputs || []) out.push({ kind: 'output', id: o.id, label: `成果：${o.name} v${o.version}` });
  chat.turns.forEach((t, i) => (t.steps || []).filter(s => s.status === 'ok' && s.text && s.kind !== 'analysis').forEach(s => out.push({ kind: 'step', id: s.id,
    label: `第 ${i + 1} 題 · ${ai(s.ai).name} · ${s.kind === 'summary' ? '總結' : s.kind === 'stage' ? `第 ${s.round} 棒${s.revision ? '（修改版）' : ''}` : `第 ${s.round} 輪`}${s.superseded ? '（舊版）' : ''}` })));
  return out;
}
export async function openDiff(preset) {
  if (!F) F = await api('/api/files/list', { pid: S.pid, cid: S.cid });
  const vs = versions(), opt = v => vs.map((x, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  const a = preset?.a ?? Math.max(0, vs.length - 2), b = preset?.b ?? vs.length - 1;
  const decs = S.chat?.decisions || [];
  $('#diffBody').innerHTML = vs.length < 2 ? '<div class="small">至少要有兩個版本才能比較。</div>' : `<div class="row2"><select class="field" id="dA">${opt(a)}</select><span>→</span><select class="field" id="dB">${opt(b)}</select></div><div id="dOut"></div>
    <label>採納紀錄　<span class="small">記下採納或拒絕了哪些建議與原因，避免只留下最後一份</span></label>
    <div class="blist">${decs.map(d => `<div><span class="st ${d.verdict === 'accepted' ? 'done' : 'failed'}" style="font-size:11px">${d.verdict === 'accepted' ? '採納' : '不採納'}</span><span class="grow">${esc(d.text)}${d.reason ? `<span class="small">　原因：${esc(d.reason)}</span>` : ''}</span><span class="small">${when(d.at)}</span><button class="btn" data-ddel="${d.id}">刪除</button></div>`).join('') || '<div>還沒有紀錄</div>'}</div>
    <div class="row2"><select class="field" id="dV" style="max-width:110px"><option value="accepted">採納</option><option value="rejected">不採納</option></select><input class="field" id="dT" placeholder="哪一項建議"><input class="field" id="dR" placeholder="原因"></div>
    <div class="row2"><label class="sk"><input type="checkbox" id="dM" checked> 同時加入專案記憶（決策或未採用的建議）</label><span class="grow"></span><button class="btn gold" id="dAdd">記錄</button></div>`;
  if (!$('#dlgDiff').open) $('#dlgDiff').showModal();
  if (vs.length >= 2) runDiff(vs);
}
async function runDiff(vs) {
  const A = vs[+$('#dA').value], B = vs[+$('#dB').value];
  const r = await api('/api/diff', { pid: S.pid, cid: S.cid, a: A, b: B });
  if (r.error) { $('#dOut').textContent = r.error; return; }
  $('#dOut').innerHTML = `<div class="small" style="margin:6px 0">新增 ${r.added} ${r.unit === 'line' ? '行' : '段'}　刪除 ${r.removed}　相同 ${r.same}</div><div class="diff">${r.ops.map(o => `<div class="${o.type}">${esc(o.text) || ' '}</div>`).join('')}</div>`;
}
export function bindDiff(reload) {
  $('#diffBody').onchange = e => { if (e.target.id === 'dA' || e.target.id === 'dB') runDiff(versions()); };
  $('#diffBody').onclick = async e => {
    if (e.target.id === 'dAdd') {
      const vs = versions(), r = await api('/api/decisions/add', { pid: S.pid, cid: S.cid, verdict: $('#dV').value, text: $('#dT').value, reason: $('#dR').value, toMemory: $('#dM').checked, from: vs[+$('#dB').value]?.label || '' });
      if (r.error) return toast(r.error); S.chat.decisions = r.decisions; toast('已記錄'); await reload(); return openDiff({ a: +$('#dA').value, b: +$('#dB').value });
    }
    if (e.target.dataset.ddel) { const r = await api('/api/decisions/delete', { pid: S.pid, cid: S.cid, id: e.target.dataset.ddel }); S.chat.decisions = r.decisions; openDiff(); }
  };
}

/* ---------- 討論分支 ---------- */
export async function branchFrom(t, reload) {
  const kind = t.mode === 'relay' ? 'stage' : 'answer';
  const max = Math.max(0, ...t.steps.filter(s => s.kind === kind && s.status === 'ok' && !s.superseded).map(s => s.round));
  if (!max) return toast('這場討論還沒有成功的回答');
  const r0 = max > 1 ? prompt(`從第幾${kind === 'stage' ? '棒' : '輪'}之後分支？（1～${max}）`, String(max)) : '1'; if (!r0) return;
  const title = prompt('分支名稱', `${S.chat.title}：方案 B`); if (!title) return;
  const r = await api('/api/chat/branch', { pid: S.pid, cid: S.cid, turnId: t.id, round: +r0, title });
  if (r.error) return toast(r.error, 4000);
  S.cid = r.id; toast(`已建立分支，複製了 ${r.copied} 個檔案作為共同背景`); reload();
}

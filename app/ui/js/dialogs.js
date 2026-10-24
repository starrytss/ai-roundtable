// 對話框：傳送內容預覽、AI 設定與權限、連線檢查、隱私與資料、工作資料夾、專案
import { $, S, api, esc, ai, av, toast, savePref, badge, P, when } from './core.js';
import { req, refreshCheck, renderComposer } from './composer.js';

const LABEL = { instructions: '專案說明', memory: '專案記憶', history: '先前對話摘要', skills: '技能內容（轉述給沒有安裝的 AI）', references: '參考網址', others: '其他 AI 的回答（第 2 輪起）' };
const ROLE = { participant: '參與討論', moderator: '主持總結' };

/* ---------- 這次會傳送的內容 ---------- */
export async function openPreview(onConfirm) {
  const dlg = $('#dlgPreview');
  if (!dlg.open) dlg.showModal();
  $('#pvBody').innerHTML = '<div class="shimmer"></div><div class="shimmer"></div>';
  const pv = await api('/api/preview', req({ q: $('#q').value.trim() || '（尚未輸入問題）' }));
  if (pv.error) { $('#pvBody').innerHTML = `<div class="notice bad">${esc(pv.error)}</div>`; return; }
  const inc = { instructions: true, memory: true, history: true, skills: false, references: true, others: true, ...(S.pref.include || {}) };
  const sample = pv.recipients.find(r => r.answer) || pv.recipients[0];
  const secs = (sample.answer || sample.summary).sections;
  const holders = key => pv.recipients.filter(r => (r.answer || r.summary).sections.some(s => s.key === key && s.included && s.sent)).map(r => esc(r.name)).join('、') || '無';
  let h = '';
  if (pv.problem) h += `<div class="notice bad">${esc(pv.problem.text)}</div>`;
  h += '<label>接收者與權限</label>' + pv.recipients.map(r => `<div class="aiset2"><div class="hd">${av(r.ai)}<b>${esc(r.name)}</b><span class="small">${r.roles.map(x => ROLE[x]).join('、')}${r.outside ? '（未勾選參與）' : ''}</span>${badge(r.guarantee)}<span class="small">${r.mode === 'manual' ? '手動貼上' : esc((S.D.levels.find(l => l.key === r.level) || {}).label || '')}</span></div>
      <ul class="notes">${(r.guarantee?.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}${r.missing ? `<li style="color:var(--danger)">找不到程式 ${esc(r.missing)}</li>` : ''}</ul></div>`).join('');
  h += `<label>要附上的內容</label><div class="row2">${Object.entries(LABEL).map(([k, l]) => `<label class="sk"><input type="checkbox" data-inc="${k}" ${inc[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="row2"><label class="sk"><input type="checkbox" id="pvRedact" ${pv.redact ? 'checked' : ''}> 送出前遮蔽敏感資訊（Email、電話、身分證、卡號、金鑰、密碼）</label></div>`;
  const found = [...(sample.answer?.findings || []), ...(sample.summary?.findings || [])];
  if (found.length) h += `<div class="notice">偵測到 ${found.length} 項敏感資訊：${[...new Set(found.map(f => `${esc(f.label)}（${esc(f.preview)} → ${esc(f.placeholder || '未遮蔽')}）`))].join('、')}</div>`;
  else if (pv.redact) h += '<div class="small">目前沒有偵測到敏感資訊（偵測是規則比對，不保證找到全部）。</div>';
  h += `<label>第 1 輪實際內容（以 ${esc(sample.name)} 為例）</label>` + secs.map(s => `<details class="sec"><summary>${esc(s.label)}<span class="who">${s.included && (s.sent || s.key === 'question') ? `送出 ${s.sent || s.chars} 字 · 傳給：${s.key === 'question' ? pv.recipients.map(r => esc(r.name)).join('、') : holders(s.key)}` : '不附上'}</span></summary>
      ${s.sources ? `<div class="small" style="padding:6px 12px">來源：${s.sources.map(x => `${esc(x.name)}（${esc(ai(x.from).name)}：${esc(x.file)}）`).join('、')}</div>` : ''}<pre>${esc(s.preview)}</pre></details>`).join('');
  const om = sample.answer?.omitted || [];
  if (om.length) h += `<div class="notice">內容預算：${om.map(o => `${esc(o.label)} ${esc(o.text)}`).join('；')}</div>`;
  h += '<div class="small">第 2 輪起，每位參與者會收到其他 AI 上一輪的回答；主持人會收到問題與最後一輪全部回答。手動貼上的 AI 由你自己複製同樣的內容到它的網站。</div>';
  $('#pvBody').innerHTML = h;
  const e = pv.estimate;
  $('#pvFoot').textContent = `預計 ${e.total} 次 CLI 呼叫（自動 ${e.auto}、手動 ${e.manual}，上限 ${e.max}）。${e.note}`;
  $('#pvSend').disabled = !!pv.problem;
  $('#pvBody').onchange = ev => {
    const k = ev.target.dataset.inc;
    if (k) (S.pref.include = S.pref.include || {})[k] = ev.target.checked;
    if (ev.target.id === 'pvRedact') S.pref.redact = ev.target.checked;
    savePref(); refreshCheck(); openPreview(onConfirm);
  };
  $('#pvSend').onclick = () => { dlg.close(); onConfirm(); };
}

/* ---------- AI 設定與權限 ---------- */
export function openAISettings() {
  const st = S.D.settings, levels = S.D.levels;
  $('#aiform').innerHTML = Object.entries(st.ais).map(([k, a]) => `<div class="aiset2" data-k="${k}">
    <div class="hd">${av(k)}<b>${esc(a.name)}</b><span class="small">${esc(a.provider === 'custom' ? '自訂指令' : ({ claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Antigravity CLI', grok: 'Grok CLI' })[a.provider] || '')}${a.untested ? '（尚未實測）' : ''}</span><span class="grow"></span>${a.mode === 'auto' ? badge(a.guarantee) : badge({ level: 'manual' })}</div>
    <div class="row2"><select class="field" data-f="mode"><option value="auto" ${a.mode === 'auto' ? 'selected' : ''}>自動（透過 CLI）</option><option value="manual" ${a.mode === 'manual' ? 'selected' : ''}>手動貼上</option></select>
      <select class="field" data-f="level" ${a.mode === 'manual' ? 'disabled' : ''}>${levels.map(l => `<option value="${l.key}" ${a.level === l.key ? 'selected' : ''}>${l.label}</option>`).join('')}</select></div>
    ${a.mode === 'auto' ? `<ul class="notes">${(a.guarantee?.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${a.mode === 'auto' && a.guarantee?.level === 'none' ? `<div class="ack"><label class="sk"><input type="checkbox" data-f="ack" ${a.ack ? 'checked' : ''}> 我了解 ${esc(a.name)} 無法由本程式限制權限，它可能讀寫電腦上的檔案或執行動作；只在我信任這次內容時使用。</label></div>` : ''}
    <input class="field" data-f="role" value="${esc(a.role)}" placeholder="角色，例如：專找漏洞的審查者" style="width:100%;margin-top:6px">
    <details><summary>進階</summary>
      <div class="row2"><input class="field" data-f="model" value="${esc(a.model)}" placeholder="模型（留空 = CLI 預設）"></div>
      ${['claude', 'codex'].includes(a.provider) ? `<label class="sk"><input type="checkbox" data-f="loadlocal" ${a.isolate === false ? 'checked' : ''}> 載入我的本機設定與技能（${a.provider === 'claude' ? 'CLAUDE.md、外掛、hooks、MCP' : 'config.toml 的通知程式與外掛'}）</label>` : ''}
      ${a.provider === 'custom' ? `<div class="row2"><input class="field" data-f="cmd" value="${esc(a.cmd)}" placeholder="自訂 CLI 指令"></div>` : ''}
      <div class="small">資料保存：${(a.records || []).map(esc).join('；')}</div>
      <button class="btn" data-reset="${k}" style="margin-top:6px">恢復預設</button>
    </details></div>`).join('');
  const L = st.limits;
  $('#limits').innerHTML = `<div class="kv"><span>每次送出的自動呼叫上限</span><input class="field" type="number" data-lim="maxCalls" value="${L.maxCalls}">
    <span>每一步最多重試</span><input class="field" type="number" data-lim="maxRetries" value="${L.maxRetries}">
    <span>單次呼叫逾時（分鐘）</span><input class="field" type="number" data-lim="timeoutMin" value="${L.timeoutMin}">
    <span>每次提示的內容預算（字）</span><input class="field" type="number" data-lim="budgetChars" value="${L.budgetChars}"></div>
    <div class="small">呼叫次數是本程式呼叫 CLI 的次數，不等於模型推論次數或費用。本程式不會自動改用付費管道。</div>`;
  $('#aiform').onchange = e => { if (['mode', 'level'].includes(e.target.dataset.f)) saveAI(false).then(openAISettings); };
  $('#aiform').onclick = async e => { const r = e.target.dataset.reset; if (r && confirm('把這個 AI 的設定恢復成預設值？')) { S.D = { ...S.D, ...(await api('/api/settings/reset-ai', { id: r })) }; openAISettings(); renderComposer(); } };
  if (!$('#dlgAI').open) $('#dlgAI').showModal();
}
export async function saveAI(close = true) {
  const ais = {};
  document.querySelectorAll('#aiform [data-k]').forEach(row => {
    const k = row.dataset.k, o = (ais[k] = {});
    row.querySelectorAll('[data-f]').forEach(i => {
      if (i.dataset.f === 'loadlocal') o.isolate = !i.checked;
      else o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value;
    });
  });
  const limits = {}; document.querySelectorAll('[data-lim]').forEach(i => limits[i.dataset.lim] = +i.value);
  const r = await api('/api/settings', { ais, limits });
  if (r.error) return toast(r.error);
  S.D = { ...S.D, ...r };
  if (close) { $('#dlgAI').close(); toast('設定已儲存'); }
  renderComposer();
}

/* ---------- 連線檢查 ---------- */
const SU = { list: null, busy: {} };
const ST = { not_installed: ['bad', '❌ 未安裝'], incompatible: ['bad', '⚠️ 版本不相容'], not_logged_in: ['warn', '⚠️ 未登入'], untested: ['man', '⏺ 尚未測試'],
  ok: ['ok', '✅ 測試通過'], quota: ['warn', '⚠️ 用量受限'], failed: ['bad', '❌ 測試失敗'], manual: ['man', '✋ 手動貼上'] };
function renderSetup() {
  if (!SU.list) { $('#setupList').innerHTML = '<div class="shimmer"></div><div class="shimmer"></div><div class="small">正在偵測你電腦上的 AI 程式…</div>'; return; }
  $('#setupList').innerHTML = SU.list.map(r => {
    const [c, label] = SU.busy[r.id] ? ['warn', '⏳ 測試中'] : ST[r.status] || ['man', r.status], b = [];
    const btn = (act, txt, gold) => `<button class="btn${gold ? ' gold' : ''}" data-su="${act}" data-id="${r.id}" ${SU.busy[r.id] ? 'disabled' : ''}>${txt}</button>`;
    if (r.status === 'not_installed') b.push(btn('install', '安裝', 1), btn('page', '說明'));
    if (r.status === 'incompatible') b.push(btn('page', '更新說明', 1));
    if (r.status === 'not_logged_in') b.push(btn('login', '登入', 1));
    if (r.installed && r.status !== 'incompatible') b.push(btn('test', '測試'));
    const when2 = r.last?.at ? `（${when(r.last.at)}）` : '';
    return `<div class="srow">${av(r.id)}<div><b>${esc(r.name)}</b><span class="st ${c}">${label}${r.status === 'ok' ? when2 : ''}</span>
      <div class="small sm">${esc(r.next || '')}${r.version ? `<br>版本：${esc(r.version)}` : ''}${r.missingFlags?.length ? `<br>缺少參數：${r.missingFlags.map(esc).join(' ')}` : ''}${r.last && !r.last.ok && r.last.raw ? `<br>原始訊息：${esc(r.last.raw.slice(0, 160))}` : ''}</div></div><div class="sa">${b.join('')}</div></div>`;
  }).join('');
}
async function checkSetup() { SU.list = null; renderSetup(); SU.list = await api('/api/setup/check', {}); renderSetup(); }
export function openSetup() { if (!$('#dlgSetup').open) $('#dlgSetup').showModal(); checkSetup(); }
export function bindSetup(reload) {
  $('#setupList').onclick = async e => {
    const b = e.target.closest('[data-su]'); if (!b || b.disabled) return;
    const { su, id } = b.dataset;
    if (su === 'test') { SU.busy[id] = true; renderSetup(); await api('/api/setup/test', { id }); SU.busy[id] = false; return checkSetup(); }
    await api('/api/setup/open', { id, action: su });
    if (su !== 'page') toast('已開啟視窗，完成後回來按「重新檢查」', 3000);
  };
  $('#setupRe').onclick = checkSetup;
  $('#setupGo').onclick = async () => {
    const ok = (SU.list || []).filter(r => r.status === 'ok').map(r => r.id);
    if (ok.length) { S.pref.ids = ok; savePref(); }
    $('#dlgSetup').close(); await reload();
  };
  $('#dlgSetup').addEventListener('close', () => { if (!S.D.settings.setupDone) { S.D.settings.setupDone = true; api('/api/setup/done', {}); } });
}

/* ---------- 隱私與資料 ---------- */
const ENC = { on: '已加密（綁定這台電腦的 Windows 帳戶）', off: '未加密', failed: '加密失敗，目前以明文保存' };
export async function openData() {
  const d = await api('/api/data/info', {}), st = S.D.settings;
  let h = '';
  if (d.recovered) h += `<div class="notice bad">資料檔損壞（${esc(d.recovered.error)}）。${d.recovered.from ? `已從備份 ${esc(d.recovered.from)} 還原` : '沒有可用的備份，已建立新資料'}；損壞的檔案保留為 ${esc(d.recovered.keptAs || '')}。</div>`;
  if (d.legacyError) h += `<div class="notice bad">${esc(d.legacyError)}</div>`;
  if (d.legacyPlaintext) h += `<div class="notice">舊版（v1.0）的明文對話已匯入並加密保存。舊檔還留在：<br><code class="inline">${esc(d.legacyPlaintext)}</code><br><button class="btn" data-act="delete-legacy" style="margin-top:6px">刪除這個明文舊檔</button></div>`;
  h += `<label>資料位置</label><div class="kv"><span>對話與設定</span><span>${esc(d.dataDir)}</span><span>工作資料夾</span><span>${esc(d.workRoot)}</span></div>
    <div class="row2"><button class="btn" data-open="data">開啟資料資料夾</button><button class="btn" data-open="backups">開啟備份資料夾</button></div>
    <label>本機加密</label><div>${esc(ENC[d.encryption] || d.encryption)}${d.encryptionError ? `：${esc(d.encryptionError)}` : ''}</div>
    <div class="small">使用 Windows DPAPI：檔案被複製到別台電腦或別的 Windows 帳戶時無法讀取。但同一個帳戶下執行的惡意程式仍可能解密，也看得到你畫面上的內容。</div>
    <div class="row2">${d.encryption === 'on' ? '<button class="btn" data-act="enc-off">關閉加密</button>' : '<button class="btn gold" data-act="enc-on">開啟加密</button>'}</div>
    <label>備份（自動保留最近 20 份；重要操作前會自動備份）</label>
    <div class="blist">${d.backups.map(b => `<div><span class="grow">${esc(new Date(b.at).toLocaleString())}　${esc(b.reason)}</span><button class="btn" data-restore="${esc(b.name)}">還原</button></div>`).join('') || '<div>還沒有備份</div>'}</div>
    <div class="row2"><button class="btn" data-act="backup">立即備份</button></div>
    <label>匯出與匯入（跨電腦移轉）</label>
    <div class="row2"><input class="field" type="password" id="expPw" placeholder="設定密碼（建議）" autocomplete="new-password"><button class="btn" data-act="export">匯出</button></div>
    <div class="row2"><input class="field" type="file" id="impFile"><input class="field" type="password" id="impPw" placeholder="匯出時的密碼" autocomplete="off"><button class="btn" data-act="import">匯入（會取代目前資料）</button></div>
    <div class="small">沒有設定密碼的匯出檔是明文，任何拿到檔案的人都看得到內容。</div>
    <label>保存期限</label><div class="row2"><input class="field" type="number" id="retDays" value="${d.retentionDays}" min="0" style="max-width:120px"><span class="small">天未更新的對話自動刪除（0 = 永久保存）</span><button class="btn" data-act="retention">套用</button></div>
    <label>送出與連線</label>
    <label class="sk"><input type="checkbox" data-priv="redact" ${st.privacy.redact ? 'checked' : ''}> 預設在送出前遮蔽敏感資訊</label>
    <label class="sk"><input type="checkbox" data-priv="reduceTraffic" ${st.privacy.reduceTraffic ? 'checked' : ''}> 關閉 Claude Code 的非必要連線（遙測、錯誤回報、自動更新檢查）</label>
    <div class="small">本程式本身不連任何外部網站（不載入網路字型、沒有分析工具）。對話內容只會透過你選擇的 AI 的官方 CLI 傳送到該服務。</div>
    <label>各家 CLI 自己保存的資料與登出</label>
    <ul class="notes">${Object.values(d.records).filter(r => r.records.length).map(r => `<li><b>${esc(r.name)}</b>：${r.records.map(esc).join('；')}${r.logout ? `；登出：<code class="inline">${esc(r.logout)}</code>` : ''}</li>`).join('')}</ul>
    <div class="small">解除安裝 AI圓桌會議不會登出這些 CLI，也不會刪除它們自己的紀錄；需要時請在終端機執行上面的登出指令。</div>`;
  $('#dataBody').innerHTML = h;
  if (!$('#dlgData').open) $('#dlgData').showModal();
}
export function bindData(reload) {
  $('#dataBody').onclick = async e => {
    const t = e.target, act = t.dataset.act;
    if (t.dataset.open) return api('/api/data/open', { which: t.dataset.open });
    if (t.dataset.restore) { if (!confirm('還原這份備份？目前的資料會先自動備份。')) return; const r = await api('/api/data/restore', { name: t.dataset.restore }); if (r.error) return toast(r.error); toast('已還原'); await reload(); return openData(); }
    if (act === 'backup') { await api('/api/data/backup', {}); toast('已備份'); return openData(); }
    if (act === 'enc-on' || act === 'enc-off') { const r = await api('/api/data/encryption', { on: act === 'enc-on' }); toast(r.encryption === 'on' ? '已加密' : r.encryption === 'off' ? '已關閉加密' : '加密失敗：' + (r.error || '')); return openData(); }
    if (act === 'delete-legacy') { if (!confirm('永久刪除這個明文舊檔？加密後的資料不受影響。')) return; await api('/api/data/delete-legacy', {}); toast('已刪除'); return openData(); }
    if (act === 'retention') { const r = await api('/api/data/retention', { days: +$('#retDays').value }); toast(r.removed ? `已刪除 ${r.removed} 個過期對話` : '已套用'); await reload(); return openData(); }
    if (act === 'export') {
      const pw = $('#expPw').value; if (!pw && !confirm('沒有設定密碼，匯出檔會是明文。確定要匯出？')) return;
      const r = await api('/api/data/export', { password: pw }); if (r.error) return toast(r.error);
      const a = document.createElement('a'), bin = Uint8Array.from(atob(r.file), c => c.charCodeAt(0));
      a.href = URL.createObjectURL(new Blob([bin])); a.download = `AI圓桌會議備份-${new Date().toISOString().slice(0, 10)}${r.protected ? '.rtexport' : '.json'}`; a.click();
      return toast('已匯出');
    }
    if (act === 'import') {
      const f = $('#impFile').files[0]; if (!f) return toast('請先選擇檔案');
      if (!confirm('匯入會取代目前的所有資料（會先自動備份）。繼續？')) return;
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(f); });
      const r = await api('/api/data/import', { file: b64, password: $('#impPw').value });
      if (r.error) return toast(r.error, 4000); toast('已匯入'); await reload(); return openData();
    }
  };
  $('#dataBody').onchange = async e => {
    const k = e.target.dataset.priv; if (!k) return;
    const r = await api('/api/settings', { privacy: { [k]: e.target.checked } }); S.D = { ...S.D, ...r }; refreshCheck(); toast('已儲存');
  };
}

/* ---------- 工作資料夾 ---------- */
export async function openFiles() {
  if (!S.cid) return toast('請先開始一個對話');
  const r = await api('/api/files/list', { pid: S.pid, cid: S.cid });
  if (r.error) return toast(r.error);
  $('#filesBody').innerHTML = `<div class="small">這個對話的 AI 只會在這個資料夾裡讀寫檔案（實際限制依各 AI 的權限設定與 CLI 能力而定）。</div>
    <div class="kv" style="margin:8px 0"><span>位置</span><span>${esc(r.dir)}</span></div>
    <div class="blist">${r.files.map(f => `<div><span class="grow">${esc(f.path)}</span><span class="small">${f.link ? '連結（不跟隨）' : `${Math.ceil((f.size || 0) / 1024)} KB · ${when(f.mtime)}`}</span></div>`).join('') || '<div>目前沒有檔案</div>'}</div>`;
  if (!$('#dlgFiles').open) $('#dlgFiles').showModal();
  $('#filesOpen').onclick = () => api('/api/data/open', { which: 'work', pid: S.pid, cid: S.cid });
}

/* ---------- 專案 ---------- */
export function bindProject(reload) {
  $('#projset').onclick = () => { const p = P() || {}; $('#pname').value = p.name || ''; $('#pinst').value = p.instructions || ''; $('#pmem').value = p.memory || ''; $('#dlgProj').showModal(); };
  $('#savep').onclick = async () => { await api('/api/project/update', { pid: S.pid, name: $('#pname').value, instructions: $('#pinst').value, memory: $('#pmem').value }); $('#dlgProj').close(); await reload(); toast('專案已儲存'); };
  $('#delp').onclick = async () => { if (!confirm('刪除整個專案與其中所有對話？刪除前會自動備份。')) return; const r = await api('/api/project/delete', { pid: S.pid }); if (r.error) return toast(r.error); $('#dlgProj').close(); S.pid = null; reload(); };
}

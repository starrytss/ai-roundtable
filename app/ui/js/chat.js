// 對話內容：每一步一張卡片、真實狀態與原因、單獨重試與續跑、只顯示 CLI 真的回報的進度
import { $, S, esc, ai, av, col, secs, when, badge, STATUS, reasonText, evText } from './core.js';
import { md } from './md.js';

export const MODES = {
  discuss: { name: '一般討論', p1: '各自提案', pn: '互相評論', d: '各自提案 → 互相評論 → 主持人整理結論', ex: '幫我評估：週末快閃店要選百貨中庭還是捷運站？' },
  debate: { name: '正反辯論', p1: '立論', pn: '交鋒', d: '第一位當正方、第二位當反方，其餘當評審', ex: '公司該不該全面導入 AI 工具？' },
  brainstorm: { name: '腦力激盪', p1: '發想', pn: '延伸組合', d: '大量發想，再互相延伸，選出前三名', ex: '幫扭蛋店想 10 個社群互動活動' },
  review: { name: '互相審查', p1: '初答', pn: '嚴格審查', d: '先回答，再互相挑錯，得到最可靠的答案', ex: '檢查這段活動企劃有什麼風險：' },
};
export const texts = {};
const expanded = new Set(), opened = new Set(), closed = new Set();
const live = t => t.steps.filter(s => !s.superseded);

function sources(s) {
  const ev = (s.events || []).filter(e => e.phase === 'end' || e.url || e.query);
  const urls = [...new Set(ev.map(e => e.url).filter(Boolean))].slice(0, 8), qs = [...new Set(ev.map(e => e.query).filter(Boolean))].slice(0, 5);
  if (!urls.length && !qs.length) return '';
  return `<div class="src">${qs.length ? '搜尋：' + qs.map(esc).join('、') : ''}${urls.length ? `<br>讀取：${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join('、')}` : ''}<span class="mtag">（由 CLI 事件記錄，不代表內容已查證）</span></div>`;
}
function meta(s) {
  const m = [];
  if (s.masked) m.push(`已遮蔽 ${s.masked} 項敏感資訊`);
  for (const o of s.omitted || []) m.push(`${esc(o.label)}：${esc(o.text)}`);
  if (s.attempts > 1) m.push(`第 ${s.attempts} 次嘗試`);
  return m.length ? `<div class="meta2">${m.join('　·　')}</div>` : '';
}
function card(t, s, extra = '') {
  const key = s.id, long = (s.text || '').length > 900, open = expanded.has(key);
  texts[key] = s.text;
  const head = `<div class="hd">${av(s.ai)}<span class="nm">${esc(ai(s.ai).name)}</span>${extra}<span class="tm">${s.ms ? secs(s.ms) : ''}</span>`;
  if (['error', 'stopped', 'interrupted', 'skipped'].includes(s.status)) {
    const e = s.error || {}, label = { error: '失敗', stopped: '已中止', interrupted: '已中斷', skipped: '已略過' }[s.status];
    const btns = [];
    if (s.kind === 'answer' && s.status !== 'skipped') btns.push(`<button class="btn" data-retry="${s.id}" data-turn="${t.id}">只重試這一步</button>`);
    if (e.action === 'login' || e.action === 'install' || e.action === 'update') btns.push(`<button class="btn" data-setup>開啟連線檢查</button>`);
    return `<div class="card err" style="--c:${col(s.ai)}">${head}</div><div class="bd">${label}：${esc(e.text || '')}</div>${meta(s)}${btns.length ? `<div class="acts2">${btns.join('')}</div>` : ''}</div>`;
  }
  return `<div class="card" style="--c:${col(s.ai)}">${head}<button class="cp" data-copytext="${esc(key)}">複製</button></div>
    ${s.stale ? '<div class="meta2 stale">這是在其他 AI 重試之前產生的回答，參考的上一輪內容已不同。</div>' : ''}
    <div class="bd md ${long && !open ? 'clamp' : ''}">${md(s.text)}</div>
    ${long ? `<button class="more" data-exp="${esc(key)}">${open ? '收合' : '展開全文'}</button>` : ''}${sources(s)}${meta(s)}</div>`;
}
function busyCard(b) {
  const a = ai(b.ai), manual = a.mode !== 'auto', quiet = !manual && ['grok', 'custom'].includes(a.provider);
  const prog = manual ? '等待你貼上回覆（下方「手動貼上」）'
    : b.events?.length ? `<ul class="prog">${b.events.slice(-5).map(e => `<li>${esc(evText(e))}</li>`).join('')}</ul>`
    : b.last?.type === 'text' ? '正在回答…' : b.last?.type === 'thinking' ? '思考中…' : quiet ? '已送出，等待回覆（這個 CLI 不回報進度）' : '已送出，等待回覆…';
  return `<div class="card busy" style="--c:${col(b.ai)}"><div class="hd">${av(b.ai)}<span class="nm">${esc(a.name)}</span><span class="tm" data-since="${b.since}"></span></div>
    <div class="bd"><span class="dots"><span></span><span></span><span></span></span>${typeof prog === 'string' && !prog.startsWith('<') ? esc(prog) : prog}</div></div>`;
}

function statusBlock(t, last, running) {
  if (running) return '';
  const L = live(t), failed = L.filter(s => s.kind === 'answer' && ['error', 'stopped', 'skipped'].includes(s.status));
  const okAns = L.some(s => s.kind === 'answer' && s.status === 'ok'), sum = L.filter(s => s.kind === 'summary').pop();
  const btn = [];
  if (failed.length && !S.run) btn.push(`<button class="btn gold" data-retryall="${t.id}">重試失敗的 AI（${failed.length}）</button>`);
  if (t.ids.length > 1 && okAns && (!sum || sum.status !== 'ok') && !S.run) btn.push(`<button class="btn" data-resum="${t.id}">只重做主持人總結</button>`);
  if (['interrupted', 'stopped', 'waiting'].includes(t.status) && L.some(s => ['pending', 'interrupted'].includes(s.status)) && !S.run) btn.push(`<button class="btn" data-resume="${t.id}">續跑未完成的步驟</button>`);
  if (last && t.ids.length > 1 && ['done', 'partial'].includes(t.status) && !S.run) btn.push(`<button class="btn" data-more="${t.id}">再討論一輪</button>`);
  if (t.summary) btn.push(`<button class="btn" data-mem="${t.id}">＋ 加入專案記憶</button><button class="btn" data-copysum="${t.id}">複製結論</button>`);
  btn.push(`<button class="btn" data-reask="${t.id}">重新提問</button>`);
  const reasons = (t.reasons || []).filter(r => !['stopped', 'interrupted'].includes(r.code) || t.status !== r.code);
  return `<div class="tstatus"><span class="st ${t.status}">${STATUS[t.status] || esc(t.status)}</span>${t.status === 'interrupted' ? '<span class="small">程式在討論中被關閉，已完成的回答都保留了。</span>' : ''}</div>
    ${reasons.length ? `<ul class="reasons">${reasons.map(r => `<li>${reasonText(r)}</li>`).join('')}</ul>` : ''}
    <div class="tools">${btn.join('')}</div>`;
}

function richQ(v) {
  return esc(v).replace(/(https?:\/\/[^\s<>"'）)\]】」，。、]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\$([A-Za-z0-9][\w.-]*)/g, '<span class="bsk">$$$1</span>');
}

export function renderChat() {
  const box = $('#inner'), log = $('#log'), chat = S.chat;
  if (!chat || !chat.turns.length) {
    $('#title').textContent = chat ? chat.title : 'AI圓桌會議';
    box.innerHTML = `<div class="welcome"><div class="seats">${Object.keys(S.D.settings.ais).map(av).join('')}</div><h1>讓 AI 們圍坐一桌</h1>
      <p>提出問題，它們會各自提案、互相挑戰，最後由主持人整理出結論。送出前會先列出這次會傳給哪些 AI。</p>
      <div class="modes">${Object.entries(MODES).map(([k, m]) => `<button class="mode" data-mode="${k}" data-ex="${esc(m.ex)}"><b>${m.name}</b><small>${m.d}</small><em>試試：${esc(m.ex)}</em></button>`).join('')}</div>
      <div class="credit">AI圓桌會議 v${esc(S.D.version)} · 由 <a href="https://samtss.com/" target="_blank" rel="noopener noreferrer">山姆蛋實驗室 SamEgg Lab</a> 製作　·　<a href="https://samtss.com/tools/ai-roundtable/" target="_blank" rel="noopener noreferrer">使用說明與常見問題</a></div></div>`;
    return;
  }
  $('#title').textContent = chat.title;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
  const run = S.run && S.run.pid === S.pid && S.run.cid === S.cid ? S.run : null;
  box.innerHTML = chat.turns.map((t, ti) => {
    if (!t.steps) return '';
    const last = ti === chat.turns.length - 1, running = run && run.turnId === t.id, M = MODES[t.mode] || MODES.discuss, solo = t.ids.length === 1;
    const busy = running ? run.busy : [], L = live(t), busyIds = new Set(busy.map(b => b.stepId));
    const who = t.ids.map(i => esc(ai(i).name)).join('、') + (solo ? '' : `　主持：${esc(ai(t.mod).name)}${t.modOutside ? '（未參與但收到內容）' : ''}`);
    let h = `<div class="turn"><div class="ask"><div class="bubble">${richQ(t.q)}</div><div class="meta">
      ${solo ? '' : `<span class="chip">${M.name}</span><span class="chip">${t.rounds} 輪</span>`}${t.redact ? '<span class="chip">已開啟遮蔽</span>' : ''}<span>傳給：${who}</span> · ${when(t.at)}</div>
      ${(t.notes || []).length ? `<ul class="notes">${t.notes.map(n => `<li>補充${n.round ? `（第 ${n.round} 輪後）` : ''}：${esc(n.text)}</li>`).join('')}</ul>` : ''}</div>`;
    const answers = r => L.filter(s => s.kind === 'answer' && s.round === r && !busyIds.has(s.id) && s.status !== 'pending').sort((x, y) => t.ids.indexOf(x.ai) - t.ids.indexOf(y.ai));
    if (solo) h += `<div class="grid" style="grid-template-columns:1fr">${answers(1).map(s => card(t, s)).join('')}${busy.map(busyCard).join('')}</div>`;
    else {
      const sum = L.filter(s => s.kind === 'summary').pop(), hasSum = sum && sum.status === 'ok';
      for (let r = 1; r <= t.rounds; r++) {
        const rm = answers(r), rb = busy.filter(b => b.kind === 'answer' && b.round === r);
        if (!rm.length && !rb.length) continue;
        const k = `${t.id}-${r}`, isOpen = opened.has(k) || (!closed.has(k) && (!hasSum || r === t.rounds || !last));
        h += `<details class="round" data-k="${k}" ${isOpen ? 'open' : ''}><summary><span class="arr">›</span><b>第 ${r} 輪</b>${r === 1 ? M.p1 : M.pn}</summary><div class="grid">${rm.map(s => card(t, s)).join('')}${rb.map(busyCard).join('')}</div></details>`;
      }
      const olds = t.steps.filter(s => s.superseded && s.status === 'ok' && s.kind === 'summary');
      if (olds.length) h += `<details class="oldsum"><summary>先前的總結（${olds.length}）</summary>${olds.map(s => card(t, s)).join('')}</details>`;
      const sb = busy.find(b => b.kind === 'summary');
      if (sb) h += `<div class="summary"><div class="hd"><span class="seal">結　論</span><span class="small">主持人 ${esc(ai(sb.ai).name)} 整理中… <span data-since="${sb.since}"></span></span></div><div class="bd">${busyCard(sb)}</div></div>`;
      else if (hasSum) { texts[sum.id] = sum.text; h += `<div class="summary"><div class="hd"><span class="seal">結　論</span><span class="small">主持人 ${esc(ai(sum.ai).name)}${sum.ms ? ' · ' + secs(sum.ms) : ''}</span></div><div class="bd md">${md(sum.text)}</div>${sources(sum)}</div>`; }
      else if (sum && sum.status !== 'pending') h += card(t, sum, '<span class="small">（總結）</span>');
    }
    h += statusBlock(t, last, running);
    return h + '</div>';
  }).join('');
  if (atBottom) log.scrollTop = log.scrollHeight;
}

export function toggleExpand(k) { expanded.has(k) ? expanded.delete(k) : expanded.add(k); }
export function rememberToggle(k, isOpen) { if (isOpen) { opened.add(k); closed.delete(k); } else { closed.add(k); opened.delete(k); } }

export function chatMarkdown() {
  const chat = S.chat; if (!chat) return '';
  let s = `# ${chat.title}\n\n`;
  for (const t of chat.turns) {
    if (!t.steps) continue;
    s += `## 問題\n\n${t.q}\n\n_狀態：${STATUS[t.status] || t.status}　傳給：${t.ids.map(i => ai(i).name).join('、')}_\n\n`;
    const solo = t.ids.length === 1;
    for (let r = 1; r <= t.rounds; r++) for (const st of live(t).filter(x => x.kind === 'answer' && x.round === r && x.status === 'ok')) s += `### ${solo ? '' : `第 ${r} 輪 · `}${ai(st.ai).name}\n\n${st.text}\n\n`;
    const sm = live(t).filter(x => x.kind === 'summary' && x.status === 'ok').pop();
    if (sm && !solo) s += `### 結論（主持人 ${ai(sm.ai).name}）\n\n${sm.text}\n\n`;
    s += '---\n\n';
  }
  return s;
}

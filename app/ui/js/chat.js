// 對話內容：每一步一張卡片、真實狀態與原因、單獨重試與續跑、只顯示 CLI 真的回報的進度
import { $, S, esc, ai, av, col, secs, when, badge, STATUS, reasonText, evText } from './core.js';
import { md } from './md.js';

export const MODES = {
  discuss: { name: '一般討論', p1: '各自提案', pn: '互相評論', d: '各自提案 → 互相評論 → 主持人整理結論', ex: '幫我評估：週末快閃店要選百貨中庭還是捷運站？' },
  debate: { name: '正反辯論', p1: '立論', pn: '交鋒', d: '第一位當正方、第二位當反方，其餘當評審', ex: '公司該不該全面導入 AI 工具？' },
  brainstorm: { name: '腦力激盪', p1: '發想', pn: '延伸組合', d: '大量發想，再互相延伸，選出前三名', ex: '幫扭蛋店想 10 個社群互動活動' },
  relay: { name: '分工接力', p1: '', pn: '', d: '依職務一棒接一棒：研究 → 企劃 → 審查 → 整理，每棒可驗收與退回修改', ex: '幫我規劃週年慶活動，從市場研究到最終企劃書' },
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
  if (typeof s.novelty === 'number') m.push(`新增資訊：${s.novelty < 0.25 ? '低' : s.novelty < 0.5 ? '中' : '高'}（以文字重疊估算）`);
  return m.length ? `<div class="meta2">${m.join('　·　')}</div>` : '';
}
function card(t, s, extra = '') {
  const key = s.id, long = (s.text || '').length > 900, open = expanded.has(key);
  texts[key] = s.text;
  const role = s.kind === 'answer' && t.mode !== 'relay' && t.roles && t.roles[s.ai];   // 這一題的分工
  const head = `<div class="hd">${av(s.ai)}<span class="nm">${esc(ai(s.ai).name)}</span>${role ? `<span class="mtag" title="${esc(role)}">${esc(role.length > 16 ? role.slice(0, 16) + '…' : role)}</span>` : ''}${extra}<span class="tm">${s.ms ? secs(s.ms) : ''}</span>`;
  if (['error', 'stopped', 'interrupted', 'skipped'].includes(s.status)) {
    const e = s.error || {}, label = { error: '失敗', stopped: '已中止', interrupted: '已中斷', skipped: '已略過' }[s.status];
    const btns = [];
    if (s.kind === 'answer' && s.status !== 'skipped') btns.push(`<button class="btn" data-retry="${s.id}" data-turn="${t.id}">只重試這一步</button>`);
    if (e.action === 'login' || e.action === 'install' || e.action === 'update') btns.push(`<button class="btn" data-setup>開啟連線檢查</button>`);
    return `<div class="card err" style="--c:${col(s.ai)}">${head}</div><div class="bd">${label}：${esc(e.text || '')}</div>${meta(s)}${btns.length ? `<div class="acts2">${btns.join('')}</div>` : ''}</div>`;
  }
  return `<div class="card" id="step-${s.id}" data-step="${s.id}" data-turn="${t.id}" data-ai="${s.ai}" data-round="${s.round ?? ''}" style="--c:${col(s.ai)}">${head}<button class="fav ${s.favorite ? 'on' : ''}" data-fav="${s.id}" data-turn="${t.id}" title="${s.favorite ? '取消收藏' : '收藏這則回答（和專案記憶分開）'}">${s.favorite ? '★' : '☆'}</button><button class="cp" data-quote="${s.id}" data-turn="${t.id}" title="引用這則回答追問">追問</button><button class="cp" data-copytext="${esc(key)}">複製</button></div>
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

// 每輪後介入：補充、略過下一輪某位 AI、繼續、自動跑完、直接總結、停在這裡
function interveneBlock(t) {
  const next = t.waitingAfter + 1, nextIds = live(t).filter(s => s.kind === 'answer' && s.round === next && s.status === 'pending').map(s => s.ai);
  const low = (t.hints || []).find(h => h.code === 'low_novelty' && h.round === t.waitingAfter);
  return `<div class="notice" data-intervene="${t.id}"><b>第 ${t.waitingAfter} 輪結束，等你決定下一步</b>${low ? '<div class="small">這一輪和上一輪很接近，新增資訊不多，建議直接總結或針對分歧查證。</div>' : ''}
    <textarea class="field" data-inote rows="2" style="width:100%;margin-top:6px" placeholder="補充限制或指示（之後的輪次與總結都會收到）"></textarea>
    ${nextIds.length ? `<div class="row2"><span class="small">第 ${next} 輪略過：</span>${nextIds.map(i => `<label class="sk"><input type="checkbox" data-iskip="${i}"> ${esc(ai(i).name)}</label>`).join('')}</div>` : ''}
    <div class="tools">${nextIds.length ? '<button class="btn gold" data-iact="continue">繼續下一輪</button><button class="btn" data-iact="auto">不再暫停 自動跑完</button>' : '<button class="btn gold" data-iact="continue">開始總結</button>'}
    ${nextIds.length && t.ids.length > 1 ? '<button class="btn" data-iact="summarize">直接總結</button>' : ''}<button class="btn" data-iact="stop">停在這裡</button></div></div>`;
}

// 共識、分歧與證據：狀態只依本程式核對過的讀取紀錄，不因為附了網址就算查證
const CLAIM = { supported: ['done', '有讀取來源支持'], cited: ['partial', '有引用但沒有讀取紀錄'], inference: ['waiting', '只有 AI 推論'], conflict: ['failed', '來源互相矛盾'], unverified: ['interrupted', '尚未查證'] };
function analysisBlock(t) {
  const step = live(t).filter(s => s.kind === 'analysis').pop();
  if (!step) return '';
  if (step.status === 'error') return `<div class="notice bad">整理失敗：${esc(step.error?.text || '')}</div>`;
  const a = t.analysis; if (!a || step.status !== 'ok') return '';
  if (a.error) return `<details class="sec"><summary>共識與證據（由 ${esc(ai(step.ai).name)} 整理）<span class="who">${esc(a.error)}</span></summary><pre>${esc(a.raw || '')}</pre></details>`;
  const by = xs => (xs || []).map(esc).join('、');
  const list = (title, items, fn) => items.length ? `<label>${title}</label><ul class="reasons">${items.map(fn).join('')}</ul>` : '';
  return `<details class="sec" open><summary>共識與證據<span class="who">由 ${esc(ai(step.ai).name)} 整理 · ${when(a.at)} · 共識不代表事實已查證</span></summary><div class="db">
    ${list('共識', a.consensus, x => `<li>${esc(x.point)}<span class="mtag">${by(x.by)}${x.reason ? '：' + esc(x.reason) : ''}</span></li>`)}
    ${list('分歧', a.disagreements, x => `<li>${esc(x.point)}<ul class="notes">${x.positions.map(p => `<li>${esc(p.by)}：${esc(p.stance)}${p.reason ? `（${esc(p.reason)}）` : ''}</li>`).join('')}</ul></li>`)}
    ${a.claims.length ? `<label>主張與證據</label>${a.claims.map((c, i) => { const [cls, lab] = CLAIM[c.status] || CLAIM.unverified; return `<div class="row2" style="align-items:flex-start"><span class="st ${cls}" style="font-size:11.5px;white-space:nowrap">${lab}</span><div style="flex:1">${esc(c.claim)}<div class="small">${c.by.length ? by(c.by) + '　' : ''}${c.sources.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>${c.readHits.includes(u) ? '（有讀取紀錄）' : ''}`).join('、')}${c.check ? `<br>${esc(c.check)}` : ''}${c.note ? `<br>${esc(c.note)}` : ''}</div></div><button class="btn" data-verify="${i}" data-turn="${t.id}">指定查證</button></div>`; }).join('')}` : ''}
    ${list('還需要查證', a.toVerify, x => `<li>${esc(x)}</li>`)}${list('需要你決定', a.toDecide, x => `<li>${esc(x)}</li>`)}
    ${a.sources.length ? `<label>實際讀取過的來源（CLI 工具紀錄）</label><ul class="notes">${a.sources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a>　${esc(ai(x.ai).name)} · ${x.at ? new Date(x.at).toLocaleTimeString().slice(0, 5) : ''}</li>`).join('')}</ul>` : '<div class="small">這場討論沒有任何讀取網頁的紀錄。</div>'}
  </div></details>`;
}

// 分工接力的驗收：通過交給下一棒、退回修改（意見只給這一棒）、不再驗收、停在這裡
function relayReviewBlock(t) {
  const r = t.waitingAfter, st = (t.stages || [])[r - 1] || {}, failed = (t.reasons || []).some(x => x.code === 'stage_failed'), last = r === (t.stages || []).length;
  if (failed) return `<div class="notice bad" data-intervene="${t.id}"><b>第 ${r} 棒（${esc(st.role)}）沒有完成</b>，後面的棒次先暫停。可以在上面的卡片按「只重試這一步」，或停在這裡。<div class="tools"><button class="btn" data-iact="stop">停在這裡</button></div><textarea data-inote hidden></textarea></div>`;
  return `<div class="notice" data-intervene="${t.id}"><b>第 ${r} 棒（${esc(st.role)}）完成，請驗收</b>${st.accept ? `<div class="small">驗收條件：${esc(st.accept)}</div>` : ''}
    <textarea class="field" data-inote rows="2" style="width:100%;margin-top:6px" placeholder="要退回修改時，寫下要改的地方（只會給這一棒）"></textarea>
    <div class="tools">${last ? '' : `<button class="btn gold" data-iact="continue">通過，交給第 ${r + 1} 棒</button>`}<button class="btn" data-iact="revise">退回修改</button>${last ? '' : '<button class="btn" data-iact="auto">不再驗收 自動跑完</button>'}<button class="btn" data-iact="stop">停在這裡</button></div></div>`;
}

function statusBlock(t, last, running) {
  if (running) return '';
  if (t.status === 'waiting' && t.waitingAfter && !S.run) return t.mode === 'relay' ? relayReviewBlock(t) : interveneBlock(t);
  const L = live(t), failed = L.filter(s => s.kind === 'answer' && !s.userSkipped && ['error', 'stopped', 'skipped'].includes(s.status));
  const okAns = L.some(s => s.kind === 'answer' && s.status === 'ok'), sum = L.filter(s => s.kind === 'summary').pop();
  const btn = [];
  if (failed.length && !S.run) btn.push(`<button class="btn gold" data-retryall="${t.id}">重試失敗的 AI（${failed.length}）</button>`);
  if (t.ids.length > 1 && okAns && (!sum || sum.status !== 'ok') && !S.run) btn.push(`<button class="btn" data-resum="${t.id}">只重做主持人總結</button>`);
  if (['interrupted', 'stopped'].includes(t.status) && L.some(s => ['pending', 'interrupted'].includes(s.status)) && !S.run) btn.push(`<button class="btn" data-resume="${t.id}">續跑未完成的步驟</button>`);
  if (last && t.ids.length > 1 && t.mode !== 'relay' && ['done', 'partial'].includes(t.status) && !S.run) btn.push(`<button class="btn" data-more="${t.id}">再討論一輪</button>`);
  if (t.summary) btn.push(`<button class="btn" data-mem="${t.id}">＋ 加入專案記憶</button><button class="btn" data-copysum="${t.id}">複製結論</button>`);
  if (okAns && t.ids.length > 1 && !S.run) btn.push(`<button class="btn" data-analyze="${t.id}">整理共識與證據</button>`);
  if (t.mode !== 'relay' && t.ids.length > 1 && !S.run && L.filter(s => s.kind === 'answer' && s.status === 'ok').length >= 2) btn.push(`<button class="btn" data-anon="${t.id}">匿名比較</button>`);
  if (t.summary && !S.run) btn.push(`<button class="btn" data-outfile="${t.id}">產生檔案</button>`);
  if (!S.run) btn.push(`<button class="btn" data-cmp="${t.id}">比較版本</button>`);
  if ((okAns || L.some(s => s.kind === 'stage' && s.status === 'ok')) && !S.run) btn.push(`<button class="btn" data-branch="${t.id}">建立分支</button>`);
  btn.push(`<button class="btn" data-reask="${t.id}">重新提問</button>`);
  const reasons = (t.reasons || []).filter(r => !['stopped', 'interrupted'].includes(r.code) || t.status !== r.code);
  const hint = (t.hints || []).find(h => h.code === 'low_novelty');
  return `<div class="tstatus"><span class="st ${t.status}">${STATUS[t.status] || esc(t.status)}</span>${t.status === 'interrupted' ? '<span class="small">程式在討論中被關閉，已完成的回答都保留了。</span>' : ''}</div>
    ${reasons.length ? `<ul class="reasons">${reasons.map(r => `<li>${reasonText(r)}</li>`).join('')}</ul>` : ''}
    ${hint ? `<div class="notice">第 ${hint.round} 輪和上一輪的內容很接近，新增資訊不多（以文字重疊估算）。可以直接用結論，或改成「整理共識與證據」後只針對分歧查證。內容接近不代表結論正確。</div>` : ''}
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
  const branchNote = chat.branchOf ? `<div class="branchnote">↳ 分支自「<span class="lnk" data-gochat="${chat.branchOf.cid}">${esc(chat.branchOf.title)}</span>」第 ${chat.branchOf.round} ${chat.branchOf.unit || '輪'}之後；之後的討論只在這個分支，不會影響原本的對話。</div>` : '';
  box.innerHTML = branchNote + chat.turns.map((t, ti) => {
    if (!t.steps) return '';
    const last = ti === chat.turns.length - 1, running = run && run.turnId === t.id, M = MODES[t.mode] || MODES.discuss, solo = t.ids.length === 1;
    const busy = running ? run.busy : [], L = live(t), busyIds = new Set(busy.map(b => b.stepId));
    const who = t.ids.map(i => esc(ai(i).name)).join('、') + (solo || t.mode === 'relay' ? '' : `　主持：${esc(ai(t.mod).name)}${t.modOutside ? '（未參與但收到內容）' : ''}`);
    let h = `<div class="turn"><div class="ask"><div class="bubble">${richQ(t.q)}</div><div class="meta">
      ${t.mode === 'relay' ? `<span class="chip">分工接力</span><span class="chip">${(t.stages || []).length} 棒</span>` : solo ? '' : `<span class="chip">${M.name}</span><span class="chip">${t.rounds} 輪</span>`}${t.branchBase ? `<span class="chip">分支起點：第 ${t.branchBase.round} ${t.mode === 'relay' ? '棒' : '輪'}</span>` : ''}${t.redact ? '<span class="chip">已開啟遮蔽</span>' : ''}<span>傳給：${who}</span> · ${when(t.at)}</div>
      ${t.quote ? `<blockquote class="small" style="margin:4px 0 0;max-width:min(720px,88%)">引用 ${esc(ai(t.quote.ai).name)}${t.quote.round ? ` 第 ${t.quote.round} 輪` : ''}：${esc(t.quote.text.slice(0, 160))}${t.quote.text.length > 160 ? '…' : ''}${t.quote.stepId ? ` <span class="lnk" data-goto="${esc(t.quote.stepId)}">跳到原文</span>` : ''}</blockquote>` : ''}
      ${t.brief ? `<div class="small">📋 ${esc(t.brief.template || '任務簡報')}：${Object.entries(t.brief.fields).filter(([, v]) => v).map(([k, v]) => `${esc((S.D.briefFields.find(f => f[0] === k) || [k, k])[1])} ${esc(v.slice(0, 40))}`).join('　')}</div>` : ''}
      ${(t.notes || []).length ? `<ul class="notes">${t.notes.map(n => `<li>補充${n.round ? `（第 ${n.round} 輪後）` : ''}：${esc(n.text)}</li>`).join('')}</ul>` : ''}</div>`;
    const answers = r => L.filter(s => s.kind === 'answer' && s.round === r && !busyIds.has(s.id) && s.status !== 'pending').sort((x, y) => t.ids.indexOf(x.ai) - t.ids.indexOf(y.ai));
    if (t.mode === 'relay') {
      (t.stages || []).forEach((st, i) => {
        const r = i + 1, cur = L.filter(s => s.kind === 'stage' && s.round === r && s.status !== 'pending' && !busyIds.has(s.id)).pop(), b = busy.find(x => x.kind === 'stage' && x.round === r);
        const old = t.steps.filter(s => s.kind === 'stage' && s.round === r && s.superseded && s.status === 'ok');
        if (!cur && !b) return;
        h += `<details class="round" open><summary><span class="arr">›</span><b>第 ${r} 棒</b>${esc(st.role)}（${esc(ai(st.ai).name)}）${cur?.revision ? ' · 修改版' : ''}</summary>
          <div class="grid" style="grid-template-columns:1fr">${b ? busyCard(b) : card(t, cur)}</div>
          ${cur?.revision ? `<div class="small">修改意見：${esc(cur.revision.feedback)}</div>` : ''}
          ${old.length ? `<details class="oldsum"><summary>先前版本（${old.length}）</summary>${old.map(o => card(t, o)).join('')}</details>` : ''}</details>`;
      });
    }
    else if (solo) h += `<div class="grid" style="grid-template-columns:1fr">${answers(1).map(s => card(t, s)).join('')}${busy.map(busyCard).join('')}</div>`;
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
    const ab = busy.find(b => b.kind === 'analysis');
    if (ab) h += `<div class="small" style="margin-top:10px">${esc(ai(ab.ai).name)} 正在整理共識與證據… <span data-since="${ab.since}"></span></div>`;
    h += analysisBlock(t) + statusBlock(t, last, running);
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

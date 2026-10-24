// 討論引擎：每位 AI、每一輪都是一個「步驟」，逐步存檔，可單獨重試、重開後續跑，結束時計算真實狀態
const { uid } = require('./store');
const { computeStatus, live } = require('./status');
const { buildPayload } = require('./context');
const providers = require('./providers');
const { run } = require('./runner');
const { classify } = require('./errors');
const { workdirFor } = require('./workspace');

const MODES = ['discuss', 'debate', 'brainstorm', 'review'];
const SECTION_KEYS = ['instructions', 'memory', 'history', 'skills', 'references', 'others'];
const err = (code, text, extra = {}) => Object.assign(new Error(text), { code, ...extra });

function createEngine({ store, skills = () => [], runCli = run, onChange = () => {} }) {
  const db = () => store.db, S = () => store.db.settings;
  let active = null;   // { pid, cid, turnId, ac, manual: Map(stepId → {resolve, prompt, ai}), busy: Map(stepId → {since, ai, round, kind, events}) }

  const find = (pid, cid, turnId) => {
    const p = db().projects.find(x => x.id === pid), c = p && p.chats.find(x => x.id === cid);
    const t = c && (turnId ? c.turns.find(x => x.id === turnId) : c.turns[c.turns.length - 1]);
    return { p, c, t };
  };
  const names = () => Object.fromEntries(Object.entries(S().ais).map(([k, v]) => [k, v.name]));

  // 重開後：跑到一半的步驟可能已經送出，標為「中斷」，要使用者確認才會重送
  for (const p of db().projects) for (const c of p.chats) for (const t of c.turns) {
    if (!t.steps || !t.steps.some(s => s.status === 'running')) continue;
    for (const s of t.steps) if (s.status === 'running') { s.status = 'interrupted'; s.error = { kind: 'interrupted', text: '程式在這一步執行時被關閉，無法確定 AI 是否已收到。' }; }
    Object.assign(t, computeStatus(t));
  }

  // ---------- 送出前檢查：參與者、主持人、確認、呼叫次數 ----------
  function normalize(req) {
    const ais = S().ais, ids = [...new Set((req.ids || []).filter(i => ais[i]))];
    if (!String(req.q || '').trim()) throw err('input', '請輸入問題');
    if (!ids.length) throw err('input', '請至少選一個 AI');
    const solo = ids.length === 1;
    const mod = solo ? ids[0] : (ais[req.mod] ? req.mod : ids[0]);
    const modOutside = !solo && !ids.includes(mod), allowOutside = req.modOutside === true;
    const rounds = solo ? 1 : Math.max(1, Math.min(4, req.rounds | 0 || 1));
    const include = {}; for (const k of SECTION_KEYS) if (typeof req.include?.[k] === 'boolean') include[k] = req.include[k];
    return { q: String(req.q).trim(), ids, mod, modOutside, allowOutside, rounds, solo, mode: MODES.includes(req.mode) ? req.mode : 'discuss', include, redact: req.redact ?? S().privacy.redact };
  }
  function recipients(n) {
    const list = n.ids.map(id => ({ ai: id, roles: ['participant'] }));
    if (!n.solo) { const m = list.find(x => x.ai === n.mod); if (m) m.roles.push('moderator'); else list.push({ ai: n.mod, roles: ['moderator'], outside: true }); }
    return list.map(r => { const a = S().ais[r.ai]; return { ...r, name: a.name, mode: a.mode, level: a.level, guarantee: a.mode === 'manual' ? { level: 'manual', notes: ['手動貼上：由你自己複製到它的網站'] } : providers.guarantee(a), needsAck: providers.needsAck(a) }; });
  }
  function estimate(n, extraRounds = 0) {
    const auto = id => S().ais[id].mode === 'auto';
    const answers = n.ids.length * (n.rounds + extraRounds), sum = n.solo ? 0 : 1;
    const autoCalls = n.ids.filter(auto).length * (n.rounds + extraRounds) + (sum && auto(n.mod) ? 1 : 0);
    return { total: answers + sum, auto: autoCalls, manual: answers + sum - autoCalls, max: S().limits.maxCalls,
      note: 'CLI 呼叫次數，不等於模型推論次數或費用；AI 使用工具時一次呼叫內可能有多個步驟' };
  }
  function check(n, est) {
    if (n.modOutside && !n.allowOutside) throw err('moderator', `主持人 ${S().ais[n.mod].name} 沒有被勾選為參與者。它仍會收到問題與最後一輪的回答；請改選已勾選的 AI 當主持人，或明確勾選「讓未參與的 AI 主持」。`, { ai: n.mod });
    for (const r of recipients(n)) if (r.needsAck) throw err('ack', `${r.name} 目前的設定無法由本程式限制權限（可能讀寫電腦上的檔案）。請先到「AI 設定」閱讀說明並確認，或改成手動貼上。`, { ai: r.ai });
    if (est.auto > S().limits.maxCalls) throw err('limit', `這次預計 ${est.auto} 次自動呼叫，超過上限 ${S().limits.maxCalls} 次。請減少 AI 或輪數，或在設定提高上限。`);
  }

  // ---------- 內容預覽（每位接收者實際會收到的內容）----------
  function preview(req) {
    const n = normalize(req), { p, c } = find(req.pid, req.cid);
    if (!p) throw err('input', '找不到專案');
    const est = estimate(n);
    const turn = { id: 'preview', q: n.q, mode: n.mode, ids: n.ids, rounds: n.rounds, steps: [], notes: [] };
    const table = new Map(), budget = S().limits.budgetChars, sk = skills();
    const per = recipients(n).map(r => {
      const ai = S().ais[r.ai], base = { project: p, chat: c || { turns: [] }, turn, ai, aiId: r.ai, names: names(), include: n.include, redact: n.redact, table, budget, skills: sk };
      const answer = r.roles.includes('participant') ? buildPayload({ ...base, round: 1 }) : null;
      const summary = r.roles.includes('moderator') ? buildPayload({ ...base, kind: 'summary' }) : null;
      const inv = ai.mode === 'auto' ? providers.invocation(ai, { workdir: '.' }) : null;
      return { ...r, answer, summary, argvPrompt: !!inv?.argvPrompt, missing: inv?.missing || null };
    });
    let problem = null; try { check(n, est); } catch (e) { problem = { code: e.code, text: e.message, ai: e.ai }; }
    return { recipients: per, estimate: est, moderator: n.mod, modOutside: n.modOutside, solo: n.solo, problem, redact: n.redact };
  }

  // ---------- 執行 ----------
  async function execStep(ctx, step) {
    const { p, c, t } = ctx, ai = S().ais[step.ai];
    const payload = buildPayload({ project: p, chat: c, turn: t, ai, aiId: step.ai, names: names(), round: step.round, kind: step.kind,
      include: t.include, redact: t.redact, table: ctx.table, budget: S().limits.budgetChars, skills: skills() });
    Object.assign(step, { status: 'running', startedAt: Date.now(), sentChars: payload.chars, omitted: payload.omitted, masked: payload.findings.length, attempts: (step.attempts || 0) + 1, error: null });
    t.maskTable = [...ctx.table];
    const busy = { since: step.startedAt, ai: step.ai, round: step.round, kind: step.kind, events: [] };
    active.busy.set(step.id, busy); store.save(); onChange();
    const t0 = Date.now();
    try {
      let text;
      if (ai.mode !== 'auto') {
        text = await new Promise((resolve, reject) => {
          active.manual.set(step.id, { resolve, reject, prompt: payload.prompt, ai: step.ai, round: step.round, kind: step.kind, turnId: t.id, pid: p.id, cid: c.id });
          onChange();
        });
      } else {
        const inv = providers.invocation(ai, { workdir: ctx.workdir, reduceTraffic: S().privacy.reduceTraffic });
        if (inv.missing) throw err('missing', `找不到程式 ${inv.missing}`);
        const r = await runCli(inv, payload.prompt, { cwd: ctx.workdir, timeoutMs: S().limits.timeoutMin * 60000, signal: active.ac.signal,
          onEvent: ev => { if (ev.type !== 'text') { busy.events.push(ev); if (busy.events.length > 60) busy.events.shift(); } busy.last = ev; onChange(); } });
        text = r.text; step.usage = r.usage || null; step.events = r.events.filter(e => e.type === 'tool').slice(0, 60);
        if (r.rateLimit) (S().usage = S().usage || {})[step.ai] = { rateLimit: r.rateLimit, at: Date.now() };
      }
      Object.assign(step, { status: 'ok', text, error: null });
    } catch (e) {
      const k = classify(e);
      Object.assign(step, { status: active.ac.signal.aborted ? 'stopped' : 'error', error: { kind: k.kind, text: k.text, action: k.action, raw: k.raw } });
    } finally {
      step.ms = Date.now() - t0; active.busy.delete(step.id); active.manual.delete(step.id);
      c.updated = Date.now(); store.save(); onChange();
    }
  }

  async function runPending(ctx) {
    const { t } = ctx, aborted = () => active.ac.signal.aborted;
    const rounds = [...new Set(live(t).filter(s => s.status === 'pending' && s.kind === 'answer').map(s => s.round))].sort((a, b) => a - b);
    for (const r of rounds) {
      if (aborted()) break;
      const steps = live(t).filter(s => s.status === 'pending' && s.kind === 'answer' && s.round === r);
      const autos = steps.filter(s => S().ais[s.ai].mode === 'auto'), manuals = steps.filter(s => !autos.includes(s));
      const a = Promise.all(autos.map(s => execStep(ctx, s)));   // 自動的同時進行，手動的依序貼上
      for (const s of manuals) { if (aborted()) break; await execStep(ctx, s); }
      await a;
    }
    const sum = live(t).find(s => s.kind === 'summary' && s.status === 'pending');
    if (sum && !aborted()) {
      const okLast = live(t).some(s => s.kind === 'answer' && s.round === t.rounds && s.status === 'ok');
      if (okLast) await execStep(ctx, sum);
      else Object.assign(sum, { status: 'skipped', error: { kind: 'skipped', text: '最後一輪沒有成功的回答，主持人沒有內容可以整理。' } });
    }
  }

  function finish(ctx) {
    const { t } = ctx;
    if (active.ac.signal.aborted) t.stopped = true;
    Object.assign(t, computeStatus(t));
    const sum = live(t).filter(s => s.kind === 'summary' && s.status === 'ok').pop();
    const solo = live(t).filter(s => s.kind === 'answer' && s.status === 'ok').pop();
    t.summary = t.ids.length > 1 ? (sum ? sum.text : '') : (solo ? solo.text : '');
    t.finishedAt = Date.now();
  }

  function launch(ctx) {
    if (active) throw err('busy', '已有討論在進行中，請等它結束或按中止');
    active = { pid: ctx.p.id, cid: ctx.c.id, turnId: ctx.t.id, ac: new AbortController(), manual: new Map(), busy: new Map(), at: Date.now() };
    ctx.t.status = 'running'; ctx.t.stopped = false; ctx.t.reasons = [];
    ctx.workdir = workdirFor(store.paths.workRoot, ctx.p.id, ctx.c.id);
    ctx.table = new Map(ctx.t.maskTable || []);
    store.save(); onChange();
    const done = runPending(ctx).catch(e => { ctx.t.engineError = e.message; }).finally(() => { finish(ctx); active = null; store.save(); onChange(); });
    return { turnId: ctx.t.id, done };
  }

  function start(req) {
    const n = normalize(req), est = estimate(n); check(n, est);
    const { p, c } = find(req.pid, req.cid);
    if (!c) throw err('input', '找不到對話');
    const t = { id: uid(), q: n.q, at: Date.now(), mode: n.mode, rounds: n.rounds, ids: n.ids, mod: n.mod, modOutside: n.modOutside,
      include: n.include, redact: n.redact, notes: [], steps: [], levels: Object.fromEntries(recipients(n).map(r => [r.ai, r.mode === 'manual' ? 'manual' : r.level])) };
    for (let r = 1; r <= n.rounds; r++) for (const id of n.ids) t.steps.push({ id: uid(), kind: 'answer', round: r, ai: id, status: 'pending', attempts: 0 });
    if (!n.solo) t.steps.push({ id: uid(), kind: 'summary', round: null, ai: n.mod, status: 'pending', attempts: 0 });
    if (!c.turns.length) c.title = n.q.slice(0, 24);
    c.turns.push(t);
    return launch({ p, c, t });
  }

  // 只重做指定步驟（失敗、中止、中斷、略過的），成功的回答保留；summary:true 只重做主持人總結
  function retry({ pid, cid, turnId, stepIds = [], summary = false, mod, modOutside }) {
    const { p, c, t } = find(pid, cid, turnId);
    if (!t) throw err('input', '找不到這次討論');
    const max = S().limits.maxRetries + 1;
    for (const id of stepIds) {
      const s = t.steps.find(x => x.id === id && !x.superseded);
      if (!s || s.kind !== 'answer' || !['error', 'stopped', 'interrupted', 'skipped'].includes(s.status)) continue;
      if ((s.attempts || 0) >= max) throw err('limit', `${S().ais[s.ai]?.name || s.ai} 第 ${s.round} 輪已重試 ${s.attempts} 次，達到上限。`);
      s.superseded = true;
      t.steps.push({ id: uid(), kind: 'answer', round: s.round, ai: s.ai, status: 'pending', attempts: s.attempts || 0, retryOf: s.id });
      for (const later of live(t)) if (later.kind === 'answer' && later.round > s.round && later.status === 'ok') later.stale = true;
    }
    if (summary || stepIds.length) {
      if (t.ids.length > 1) {
        const old = live(t).filter(x => x.kind === 'summary').pop();
        let m = mod || old?.ai || t.mod;
        if (!t.ids.includes(m) && !(modOutside === true || (m === t.mod && t.modOutside))) throw err('moderator', '主持人必須是已勾選的 AI，或明確同意讓未參與的 AI 主持');
        if (old) old.superseded = true;
        t.steps.push({ id: uid(), kind: 'summary', round: null, ai: m, status: 'pending', attempts: old && old.ai === m ? old.attempts || 0 : 0 });
      }
    }
    if (!live(t).some(s => s.status === 'pending')) throw err('input', '沒有可以重試的步驟');
    return launch({ p, c, t });
  }

  // 續跑：已完成的不重送；中斷的步驟（可能已送出）要 resend:true 才會重送
  function resume({ pid, cid, turnId, resend = false }) {
    const { p, c, t } = find(pid, cid, turnId);
    if (!t) throw err('input', '找不到這次討論');
    const interrupted = live(t).filter(s => s.status === 'interrupted');
    if (interrupted.length && !resend) throw err('confirm', `有 ${interrupted.length} 個步驟在中斷時可能已送出，重新送出會再呼叫一次。`, { steps: interrupted.map(s => ({ id: s.id, ai: s.ai, round: s.round, kind: s.kind })) });
    for (const s of interrupted) { s.superseded = true; t.steps.push({ id: uid(), kind: s.kind, round: s.round, ai: s.ai, status: 'pending', attempts: s.attempts || 0, retryOf: s.id }); }
    if (!live(t).some(s => s.status === 'pending')) throw err('input', '沒有需要續跑的步驟');
    return launch({ p, c, t });
  }

  // 再討論一輪：新增一輪回答並重做總結
  function more({ pid, cid, turnId }) {
    const { p, c, t } = find(pid, cid, turnId);
    if (!t || t.ids.length < 2) throw err('input', '只有多個 AI 的討論才能再加一輪');
    const est = estimate({ ...t, solo: false, rounds: 1 });
    if (est.auto > S().limits.maxCalls) throw err('limit', '超過呼叫上限');
    t.rounds += 1;
    for (const id of t.ids) t.steps.push({ id: uid(), kind: 'answer', round: t.rounds, ai: id, status: 'pending', attempts: 0 });
    const old = live(t).filter(x => x.kind === 'summary').pop(); if (old) old.superseded = true;
    t.steps.push({ id: uid(), kind: 'summary', round: null, ai: t.mod, status: 'pending', attempts: 0 });
    return launch({ p, c, t });
  }

  function stop() {
    if (!active) return false;
    active.ac.abort();
    for (const m of active.manual.values()) m.reject(Object.assign(new Error('已中止'), { code: 'ABORT' }));
    return true;
  }
  // 手動貼上：回覆一定要對到當初要求的那一步，避免送進錯誤的對話
  function manual({ stepId, text }) {
    const m = active && active.manual.get(stepId);
    if (!m) throw err('input', '這個手動貼上的步驟已經結束或不存在，回覆沒有被送出。');
    if (!String(text || '').trim()) throw err('input', '請貼上回覆內容');
    m.resolve(String(text)); return true;
  }
  function state() {
    if (!active) return null;
    return { pid: active.pid, cid: active.cid, turnId: active.turnId, at: active.at,
      busy: [...active.busy].map(([id, b]) => ({ stepId: id, ai: b.ai, round: b.round, kind: b.kind, since: b.since, last: b.last || null, events: b.events.slice(-8) })),
      manual: [...active.manual].map(([id, m]) => ({ stepId: id, ai: m.ai, round: m.round, kind: m.kind, prompt: m.prompt, pid: m.pid, cid: m.cid })) };
  }

  return { preview, start, retry, resume, more, stop, manual, state, recipients: req => recipients(normalize(req)), get busy() { return !!active; } };
}

module.exports = { createEngine };

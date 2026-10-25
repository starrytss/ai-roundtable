// AI圓桌會議 v1.1（山姆蛋實驗室）：Node.js 18+，不需安裝套件
// 啟動：雙擊「AI圓桌會議」捷徑，或執行 node app/server.js [--app] [--replace] [--port N] [--data-dir 路徑]
const http = require('http'), fs = require('fs'), path = require('path'), { exec, execFile } = require('child_process');
const { resolvePaths } = require('./lib/paths');
const { openStore, newProject, uid, DEFAULT_AIS } = require('./lib/store');
const { createEngine } = require('./lib/engine');
const { scanSkills } = require('./lib/skills');
const providers = require('./lib/providers');
const diagnose = require('./lib/diagnose');
const sec = require('./lib/security');
const { workdirFor, resolveInside, listFiles } = require('./lib/workspace');
const { BRIEF_FIELDS, MEM_LABEL } = require('./lib/context');
const outputs = require('./lib/outputs');
const { search } = require('./lib/search');
const crypto = require('crypto');
const IMG_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const { diff } = require('./lib/diff');
const { branchChat, copyWorkspace } = require('./lib/branch');

// 分工接力的團隊範本：職務與 AI 分開，同一個職務可以換不同 AI
const defaultRelays = () => [
  { name: '研究 → 企劃 → 審查 → 整理', stages: [
    { role: '資料研究', ai: 'claude', task: '蒐集與問題相關的事實、數據與案例，附上來源網址，標明哪些是推論。', accept: '每個重要事實都有來源或標明推論', input: 'question' },
    { role: '企劃提案', ai: 'chatgpt', task: '根據研究結果提出具體方案，包含步驟、時程與預算。', accept: '方案可以直接執行，數字有依據', input: 'previous' },
    { role: '風險審查', ai: 'claude', task: '嚴格檢查方案的漏洞、風險與錯誤，提出修正建議。', accept: '列出風險等級與具體修正方式', input: 'all' },
    { role: '最終整理', ai: 'chatgpt', task: '整合前面的內容與審查意見，產出最終版本。', accept: '採納或不採納審查意見都說明原因', input: 'all' }] },
  { name: '需求 → 實作 → 測試', stages: [
    { role: '需求整理', ai: 'claude', task: '把問題整理成明確的需求清單與驗收條件。', accept: '每個需求都可以驗收', input: 'question' },
    { role: '實作', ai: 'chatgpt', task: '依需求完成實作或詳細設計。', accept: '逐條對應需求', input: 'previous' },
    { role: '測試審查', ai: 'claude', task: '依驗收條件逐條檢查，列出未通過與修正方式。', accept: '每條需求都有通過或未通過的結論', input: 'all' }] },
];
const MAX_MATERIAL = 200000;

const MEM_TYPES = Object.keys(MEM_LABEL);
const localDate = () => new Date().toLocaleDateString('sv-SE');   // 本地日期 YYYY-MM-DD
// 常用的任務簡報範本（使用者可另存自己的版本）
const defaultBriefs = () => [
  { name: '活動企劃', fields: { goal: '', audience: '', budget: '', timeline: '', constraints: '', format: '活動提案：目標、流程、預算表、風險與備案' }, ask: ['goal', 'audience', 'budget', 'timeline'] },
  { name: '網站開發', fields: { goal: '', audience: '', budget: '', timeline: '', constraints: '', format: '需求清單、頁面架構、技術選擇與驗收條件' }, ask: ['goal', 'audience', 'timeline', 'constraints'] },
  { name: '供應商比較', fields: { goal: '', audience: '', budget: '', timeline: '', constraints: '', format: '比較表：價格、條件、風險，最後給建議' }, ask: ['goal', 'budget', 'constraints'] },
];

const VERSION = '1.4.0';
const ROOT = path.resolve(__dirname, '..'), UI = path.join(__dirname, 'ui');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APP = process.argv.includes('--app');

async function main({ port = Number(arg('--port', 3456)), dataDir = arg('--data-dir'), open = APP, protector, exitOnQuit = true } = {}) {
  const paths = resolvePaths({ appDir: ROOT, dataDir });
  fs.mkdirSync(paths.dataDir, { recursive: true });

  // 安裝與解除安裝用：請正在執行的 AI圓桌會議 自己結束（先確認身分）
  if (process.argv.includes('--stop')) { const r = await sec.stopRunning(paths.lockFile); console.log(r.stopped ? '已關閉 AI圓桌會議' : '沒有正在執行的 AI圓桌會議'); return { stopped: r.stopped }; }
  // 單一執行個體：已有確定是本程式的執行個體 → --replace 時請它結束，否則直接打開它的視窗
  const running = await sec.findRunning(paths.lockFile);
  if (running) {
    if (process.argv.includes('--replace')) { const r = await sec.stopRunning(paths.lockFile); if (!r.stopped) { console.log('無法關閉正在執行的 AI圓桌會議：' + r.reason); process.exit(1); } }
    else { console.log('AI圓桌會議已經在執行：http://localhost:' + running.port); if (open) openWindow(running.port); return { alreadyRunning: running }; }
  }

  let store;
  try { store = openStore(paths, protector ? { protector } : {}); }
  catch (e) { console.log('\n無法開啟資料：' + e.message + '\n'); if (open) execFile('mshta', [`javascript:alert(${JSON.stringify('AI圓桌會議無法開啟資料：' + e.message)});close()`]); process.exit(1); }
  store.purgeExpired();
  // 安裝程式記錄的「有訂閱的 AI」：第一次開啟時套用，其他設成手動貼上；只含 AI 代號，用完即刪
  const firstRun = path.join(ROOT, 'first-run.json');
  if (fs.existsSync(firstRun)) {
    try { const chosen = JSON.parse(fs.readFileSync(firstRun, 'utf8')).auto || []; if (!store.db.settings.setupDone) for (const [k, a] of Object.entries(store.db.settings.ais)) a.mode = chosen.includes(k) ? 'auto' : 'manual'; store.save(); } catch {}
    fs.rmSync(firstRun, { force: true });
  }
  const engine = createEngine({ store, skills: () => scanSkills(), onIdle: () => processQueue() });
  const attachDir = (pid, cid) => path.join(paths.dataDir, 'attachments', pid, cid);
  // 任務佇列：一次跑一個；重開程式時不自動開始，先暫停讓使用者確認
  if ((store.db.queue || []).some(q => q.status === 'queued' || q.status === 'running')) {
    for (const q of store.db.queue) if (q.status === 'running') q.status = 'interrupted';
    store.db.queuePaused = true; store.save();
  }
  function processQueue() {
    const Q = store.db.queue || [];
    for (const q of Q.filter(x => x.status === 'running')) {   // 更新剛結束的那一項
      const t = findC(findP(q.pid), q.cid)?.turns.find(x => x.id === q.turnId);
      if (t && !['running'].includes(t.status)) { q.status = 'finished'; q.result = t.status; q.endedAt = Date.now(); }
    }
    if (engine.busy || store.db.queuePaused) return store.save();
    const next = Q.find(x => x.status === 'queued');
    if (next) {
      try { const r = engine.start(next.req); Object.assign(next, { status: 'running', turnId: r.turnId, startedAt: Date.now() }); }
      catch (e) { Object.assign(next, { status: 'failed', error: e.message, endedAt: Date.now() }); setImmediate(processQueue); }
    }
    store.save();
  }

  // 連接埠被其他程式占用時改用下一個，不會去結束別人的程式
  const server = http.createServer();
  const listen = p => new Promise((res, rej) => { server.once('error', rej); server.listen(p, '127.0.0.1', () => { server.off('error', rej); res(server.address().port); }); });
  let actual;
  for (let p = port, n = 0; ; p++, n++) { try { actual = await listen(p); break; } catch (e) { if (e.code !== 'EADDRINUSE' || n >= 9 || port === 0) throw e; } }
  const token = sec.newToken(), hosts = sec.hostsFor(actual), lock = sec.writeLock(paths.lockFile, actual);
  let lastHit = Date.now();
  const quit = () => { sec.clearLock(paths.lockFile, lock); engine.stop(); server.close(); if (exitOnQuit) setTimeout(() => process.exit(0), 300).unref(); };
  if (exitOnQuit) { process.on('SIGINT', quit); process.on('SIGTERM', quit); }
  if (open) setInterval(() => { if (!engine.busy && Date.now() - lastHit > 150000) quit(); }, 10000).unref();

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { ...sec.SECURITY_HEADERS, 'Content-Type': type + '; charset=utf-8' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req, max = 60 * 1024 * 1024) => new Promise((res, rej) => {
    let n = 0; const parts = [];
    req.on('data', d => { n += d.length; if (n > max) { rej(new Error('內容太大')); req.destroy(); } else parts.push(d); });
    req.on('end', () => { try { res(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { res({}); } });
  });
  const STATIC = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };
  const db = () => store.db, findP = id => db().projects.find(p => p.id === id), findC = (p, id) => p && p.chats.find(c => c.id === id);
  const diag = () => (db().settings.diag = db().settings.diag || {});

  server.on('request', async (req, res) => {
    const u = new URL(req.url, 'http://x'), url = u.pathname;
    if (!sec.trusted(req, u, { token, hosts })) return send(res, 403, { error: 'forbidden' });
    lastHit = Date.now();
    try {
      if (url === '/__identity') return send(res, 200, { app: 'ai-roundtable', instance: lock.instance, version: VERSION });
      if (url === '/__shutdown' && req.method === 'POST') { if (req.headers['x-rt-secret'] !== lock.secret) return send(res, 403, { error: 'forbidden' }); send(res, 200, { ok: true }); return quit(); }
      if (url === '/') return send(res, 200, fs.readFileSync(path.join(UI, 'index.html'), 'utf8').replace('<meta charset="utf-8">', `$&\n<meta name="rt-token" content="${token}">`), 'text/html');
      if (url.startsWith('/ui/') && req.method === 'GET') {
        const f = resolveInside(UI, decodeURIComponent(url.slice(4)));
        if (!STATIC[path.extname(f)] || !fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(f), STATIC[path.extname(f)]);
      }
      if (req.method === 'GET') {
        if (url === '/api/state') return send(res, 200, stateView());
        if (url === '/api/chat') {
          const c = findC(findP(u.searchParams.get('pid')), u.searchParams.get('cid'));
          return send(res, 200, { chat: c ? { ...c, attachments: (c.attachments || []).map(({ path: _p, ...x }) => x), turns: c.turns.map(t => t.images ? { ...t, images: t.images.map(({ path: _p, ...x }) => x) } : t) } : null, now: Date.now(), run: engine.state() });
        }
        if (url === '/api/skills') return send(res, 200, scanSkills({ refresh: !!u.searchParams.get('refresh') }));
        return send(res, 404, { error: 'not found' });
      }
      const b = await readBody(req), p = findP(b.pid);
      const out = await route(url, b, p);
      return send(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      return send(res, 200, { error: e.message, code: e.code, ai: e.ai, steps: e.steps });
    }
  });

  function stateView() {
    const s = db().settings;
    const ais = Object.fromEntries(Object.entries(s.ais).map(([k, a]) => [k, { ...a, guarantee: a.mode === 'manual' ? null : providers.guarantee(a), needsAck: providers.needsAck(a), seat: !DEFAULT_AIS()[k],
      caps: providers.capabilities(a), imageNote: (providers.PROVIDERS[a.provider] || {}).imageNote || '', modelNote: (providers.PROVIDERS[a.provider] || {}).modelNote || '',
      records: (providers.PROVIDERS[a.provider] || {}).records || [], untested: !!(providers.PROVIDERS[a.provider] || {}).untested, argvPrompt: !!(providers.PROVIDERS[a.provider] || {}).argvPrompt }]));
    return {
      version: VERSION, settings: { ...s, ais, briefTemplates: s.briefTemplates || defaultBriefs(), relayTemplates: s.relayTemplates || defaultRelays() },
      outputTemplates: Object.entries(outputs.OUTPUT_TEMPLATES).map(([key, v]) => ({ key, name: v.name })), levels: providers.LEVELS.map(k => ({ key: k, label: providers.LEVEL_LABEL[k] })),
      briefFields: BRIEF_FIELDS, memLabels: MEM_LABEL, queue: (db().queue || []).slice(-50).map(({ req, ...q }) => ({ ...q, q: String(req?.q || '').slice(0, 60), ids: req?.ids, mode: req?.mode })), queuePaused: !!db().queuePaused,
      projects: db().projects.map(p => ({ ...p, materials: (p.materials || []).map(({ text, ...m }) => ({ ...m, chars: (text || '').length })), chats: p.chats.map(c => ({ id: c.id, title: c.title, updated: c.updated, status: (c.turns.at(-1) || {}).status, tags: c.tags || [], branchOf: c.branchOf ? { cid: c.branchOf.cid, title: c.branchOf.title } : undefined })).sort((a, b) => b.updated - a.updated) })),
      privacy: { ...store.state, dataDir: paths.dataDir, workRoot: paths.workRoot, backups: store.listBackups().length },
      run: engine.state(),
    };
  }

  async function route(url, b, p) {
    const S = db().settings;
    switch (url) {
      case '/api/project/new': { const n = newProject(String(b.name || '新專案').slice(0, 80)); db().projects.unshift(n); store.save(); return { id: n.id }; }
      case '/api/project/update': if (p) { for (const f of ['name', 'instructions', 'memory']) if (typeof b[f] === 'string') p[f] = b[f]; store.save(); } return;
      case '/api/project/delete':
        if (engine.state()?.pid === b.pid) throw new Error('這個專案正在討論中');
        store.backup('before-delete-project');
        db().projects = db().projects.filter(x => x.id !== b.pid);
        if (!db().projects.length) db().projects.push(newProject());
        store.save(); return;
      case '/api/chat/new': { if (!p) throw new Error('找不到專案'); const c = { id: uid(), title: '新對話', updated: Date.now(), turns: [] }; p.chats.push(c); store.save(); return { id: c.id }; }
      case '/api/chat/delete':
        if (engine.state()?.cid === b.cid) throw new Error('這個對話正在討論中');
        if (p) { p.chats = p.chats.filter(c => c.id !== b.cid); fs.rmSync(attachDir(p.id, String(b.cid).replace(/[^a-z0-9]/gi, '')), { recursive: true, force: true }); store.save(); } return;
      case '/api/chat/rename': { const c = findC(p, b.cid); if (c && String(b.title || '').trim()) { c.title = String(b.title).trim().slice(0, 60); store.save(); } return; }
      case '/api/memory/add': {
        if (!p || !String(b.text || '').trim()) throw new Error('沒有要加入的內容');
        if (!MEM_TYPES.includes(b.type)) { p.memory = (p.memory ? p.memory + '\n\n' : '') + String(b.text); store.save(); return; }
        const src = b.source || {}, c = findC(p, src.cid);
        p.memories.push({ id: uid(), type: b.type, text: String(b.text).trim().slice(0, 4000), status: 'active', date: localDate(), at: Date.now(),
          source: { cid: c?.id || null, chat: c?.title || '', turnId: String(src.turnId || '').slice(0, 40), ai: String(src.ai || '').slice(0, 20) } });
        store.save(); return { memories: p.memories };
      }
      case '/api/memory/update': {
        const m = p && p.memories.find(x => x.id === b.id); if (!m) throw new Error('找不到這筆記憶');
        if (b.replace) {   // 取代：保留舊的並標為已取代，新增一筆記錄取代關係
          m.status = 'replaced';
          p.memories.push({ ...m, id: uid(), text: String(b.text || m.text).trim().slice(0, 4000), type: MEM_TYPES.includes(b.type) ? b.type : m.type, status: 'active', replaces: m.id, date: localDate(), at: Date.now() });
        } else { if (typeof b.text === 'string') m.text = b.text.trim().slice(0, 4000); if (MEM_TYPES.includes(b.type)) m.type = b.type; m.updatedAt = Date.now(); }
        store.save(); return { memories: p.memories };
      }
      case '/api/memory/delete': if (p) { p.memories = p.memories.filter(x => x.id !== b.id); store.save(); } return { memories: p ? p.memories : [] };
      case '/api/briefs/save': {
        const name = String(b.name || '').trim().slice(0, 40); if (!name) throw new Error('請輸入範本名稱');
        S.briefTemplates = (S.briefTemplates || defaultBriefs()).filter(x => x.name !== name);
        S.briefTemplates.push({ name, fields: Object.fromEntries(BRIEF_FIELDS.map(([k]) => [k, String(b.fields?.[k] || '').slice(0, 2000)])), ask: (b.ask || []).filter(k => BRIEF_FIELDS.some(([f]) => f === k)) });
        store.save(); return { briefTemplates: S.briefTemplates };
      }
      case '/api/briefs/delete': S.briefTemplates = (S.briefTemplates || defaultBriefs()).filter(x => x.name !== b.name); store.save(); return { briefTemplates: S.briefTemplates };
      case '/api/turn/intervene': { const r = engine.intervene(b); return { turnId: r.turnId }; }
      case '/api/turn/analyze': { const r = engine.analyze(b); return { turnId: r.turnId }; }

      case '/api/settings': {
        for (const [k, v] of Object.entries(b.ais || {})) {
          const a = S.ais[k]; if (!a || !v) continue;
          for (const f of ['name', 'role', 'model', 'cmd']) if (typeof v[f] === 'string') a[f] = v[f].trim().slice(0, f === 'role' ? 300 : 200);
          if (['auto', 'manual'].includes(v.mode)) a.mode = v.mode;
          if (providers.LEVELS.includes(v.level)) { if (v.level !== a.level) a.ack = false; a.level = v.level; }
          if (typeof v.ack === 'boolean') a.ack = v.ack;
          if (typeof v.isolate === 'boolean') a.isolate = v.isolate;
          if (a.provider === 'custom' && !a.cmd) a.mode = 'manual';
        }
        if (b.privacy) { if (typeof b.privacy.redact === 'boolean') S.privacy.redact = b.privacy.redact; if (typeof b.privacy.reduceTraffic === 'boolean') S.privacy.reduceTraffic = b.privacy.reduceTraffic; }
        if (b.limits) for (const [k, lo, hi] of [['maxCalls', 1, 100], ['maxRetries', 0, 10], ['timeoutMin', 1, 60], ['budgetChars', 4000, 200000], ['maxMinutes', 1, 600]]) if (Number.isFinite(+b.limits[k])) S.limits[k] = Math.max(lo, Math.min(hi, Math.round(+b.limits[k])));
        store.save(); return stateView();
      }
      case '/api/settings/reset-ai': { const def = DEFAULT_AIS()[b.id]; if (def) { S.ais[b.id] = { ...def }; store.save(); } return stateView(); }

      case '/api/preview': return engine.preview(b);
      case '/api/send': { const r = engine.start(b); return { turnId: r.turnId }; }
      case '/api/turn/retry': { const r = engine.retry(b); return { turnId: r.turnId }; }
      case '/api/turn/resume': { const r = engine.resume(b); return { turnId: r.turnId }; }
      case '/api/turn/more': { const r = engine.more(b); return { turnId: r.turnId }; }
      case '/api/stop': engine.stop(); return;
      case '/api/manual': engine.manual(b); return;

      case '/api/setup/check': return Promise.all(Object.entries(S.ais).map(([k, a]) => diagnose.check(k, a, diag()[k])));
      case '/api/setup/test': {
        const a = S.ais[b.id]; if (!a) throw new Error('找不到這個 AI');
        if (a.mode === 'manual') return { ok: false, text: '手動貼上模式不需要測試。' };
        const r = await diagnose.test(a, { workdir: workdirFor(paths.workRoot, 'diagnose00', 'connection') });
        diag()[b.id] = r; if (r.rateLimit) (S.usage = S.usage || {})[b.id] = { rateLimit: r.rateLimit, at: Date.now() };
        store.save(); return r;
      }
      case '/api/setup/open': {
        const a = S.ais[b.id], s = (providers.PROVIDERS[a?.provider] || {}).setup || {};
        if (process.platform !== 'win32') return;
        if (b.action === 'page' && /^https:\/\//.test(s.page || '')) execFile('cmd', ['/c', 'start', '', s.page], { windowsHide: true });
        else if (b.action === 'install' && s.install) openConsole(`${a.name}：安裝`, installScript(s.install));
        else if (b.action === 'login' && s.login) openConsole(`${a.name}：登入`, s.login);
        return;
      }
      case '/api/setup/done': S.setupDone = true; store.save(); return;

      case '/api/data/info': return { ...store.state, dataDir: paths.dataDir, workRoot: paths.workRoot, backups: store.listBackups(), retentionDays: S.privacy.retentionDays,
        records: Object.fromEntries(Object.entries(providers.PROVIDERS).map(([k, v]) => [k, { name: v.name, records: v.records || [], logout: v.setup?.logout || '' }])) };
      case '/api/data/backup': return { name: store.backup('manual') };
      case '/api/data/restore': if (engine.busy) throw new Error('討論進行中，請等它結束再還原'); store.restore(String(b.name)); return stateView();
      case '/api/data/export': return { file: store.exportData({ password: b.password || '' }).toString('base64'), protected: !!b.password };
      case '/api/data/import': if (engine.busy) throw new Error('討論進行中，請等它結束再匯入'); store.importData(Buffer.from(String(b.file || ''), 'base64'), { password: b.password }); return stateView();
      case '/api/data/encryption': return { encryption: store.setEncryption(!!b.on), error: store.state.encryptionError };
      case '/api/data/retention': { S.privacy.retentionDays = Math.max(0, Math.min(3650, b.days | 0)); store.save(); return { removed: store.purgeExpired() }; }
      case '/api/data/delete-legacy': return { deleted: store.deleteLegacyPlaintext() };
      case '/api/data/open': {
        const dir = b.which === 'work' && p && b.cid ? workdirFor(paths.workRoot, p.id, b.cid) : b.which === 'backups' ? paths.backupDir : paths.dataDir;
        if (process.platform === 'win32') execFile('explorer.exe', [dir], { windowsHide: true }, () => {});
        return { dir };
      }
      case '/api/files/list': { const c = findC(p, b.cid); if (!c) throw new Error('找不到對話'); const dir = workdirFor(paths.workRoot, p.id, c.id); return { dir, files: outputs.fileIndex(dir, c), outputs: (c.outputs || []).map(({ text, ...o }) => o) }; }
      case '/api/files/read': { const c = findC(p, b.cid); if (!c) throw new Error('找不到對話'); return outputs.readFile(workdirFor(paths.workRoot, p.id, c.id), String(b.path || '')); }
      case '/api/files/download': {
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        const file = resolveInside(workdirFor(paths.workRoot, p.id, c.id), String(b.path || '')), st = fs.lstatSync(file);
        if (st.isSymbolicLink() || !st.isFile()) throw new Error('只能下載一般檔案');
        if (st.size > 30 * 1024 * 1024) throw new Error('檔案超過 30 MB，請用「在檔案總管開啟」');
        return { name: path.basename(file), file: fs.readFileSync(file).toString('base64') };
      }
      case '/api/outputs/save': {
        const c = findC(p, b.cid), t = c && c.turns.find(x => x.id === b.turnId); if (!t) throw new Error('找不到這場討論');
        const st = b.stepId ? t.steps.find(x => x.id === b.stepId && x.status === 'ok') : null, text = st ? st.text : t.summary;
        if (!text) throw new Error('這場討論還沒有可以輸出的結論');
        const rec = outputs.saveOutput({ workdir: workdirFor(paths.workRoot, p.id, c.id), chat: c, name: String(b.name || t.q.slice(0, 30)), format: b.format, text,
          from: { turnId: t.id, stepId: st ? st.id : '', ai: st ? st.ai : (t.steps.filter(x => ['summary', 'stage'].includes(x.kind) && x.status === 'ok' && !x.superseded).sort((x, y) => (x.round || 99) - (y.round || 99)).pop() || {}).ai, kind: st ? st.kind : t.mode === 'relay' ? 'stage' : 'summary' }, template: t.outputTemplate || '' });
        c.updated = Date.now(); store.save(); const { text: _t, ...o } = rec; return { output: o };
      }
      case '/api/outputs/restore': {   // 回到先前版本：把舊版內容存成新的版本，不刪除任何版本
        const c = findC(p, b.cid), o = c && (c.outputs || []).find(x => x.id === b.outputId); if (!o) throw new Error('找不到這個版本');
        const rec = outputs.saveOutput({ workdir: workdirFor(paths.workRoot, p.id, c.id), chat: c, name: o.name, format: o.format, text: o.text, from: { ...o.from, kind: 'restore' }, template: o.template });
        rec.restoredFrom = o.version; store.save(); const { text: _t, ...r } = rec; return { output: r };
      }
      case '/api/diff': {
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        const pick = x => {
          if (!x) return null;
          if (x.kind === 'output') { const o = (c.outputs || []).find(y => y.id === x.id); return o && { text: o.text, label: `${o.name} v${o.version}` }; }
          for (const t of c.turns) { const st = t.steps.find(y => y.id === x.id); if (st) return { text: st.text, label: `${S.ais[st.ai]?.name || st.ai} · ${st.kind === 'summary' ? '總結' : st.kind === 'stage' ? '第 ' + st.round + ' 棒' : '第 ' + st.round + ' 輪'}` }; }
          return null;
        };
        const a = pick(b.a), z = pick(b.b); if (!a || !z) throw new Error('請選擇兩個要比較的版本');
        return { a: a.label, b: z.label, ...diff(a.text, z.text) };
      }
      case '/api/decisions/add': {
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        if (!['accepted', 'rejected'].includes(b.verdict) || !String(b.text || '').trim()) throw new Error('請填寫建議內容並選擇採納或不採納');
        const d = { id: uid(), verdict: b.verdict, text: String(b.text).trim().slice(0, 2000), reason: String(b.reason || '').trim().slice(0, 2000), from: String(b.from || '').slice(0, 120), at: Date.now() };
        (c.decisions = c.decisions || []).push(d);
        if (b.toMemory) p.memories.push({ id: uid(), type: d.verdict === 'accepted' ? 'decision' : 'rejected', text: d.text + (d.reason ? `（原因：${d.reason}）` : ''), status: 'active', date: localDate(), at: Date.now(), source: { cid: c.id, chat: c.title, turnId: '', ai: '' } });
        store.save(); return { decisions: c.decisions };
      }
      case '/api/decisions/delete': { const c = findC(p, b.cid); if (c) { c.decisions = (c.decisions || []).filter(x => x.id !== b.id); store.save(); } return { decisions: c ? c.decisions : [] }; }
      case '/api/chat/branch': {
        if (engine.busy) throw new Error('討論進行中，請等它結束再建立分支');
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        const n = branchChat({ project: p, chat: c, turnId: b.turnId, round: b.round, title: b.title, uid });
        const copied = copyWorkspace(workdirFor(paths.workRoot, p.id, c.id), workdirFor(paths.workRoot, p.id, n.id));
        store.save(); return { id: n.id, copied };
      }
      case '/api/materials/add': {
        if (!p) throw new Error('找不到專案');
        const kind = ['text', 'url', 'file'].includes(b.kind) ? b.kind : 'text', url = String(b.url || '').trim();
        if (kind === 'url' && !/^https?:\/\/\S+$/.test(url)) throw new Error('網址必須以 http:// 或 https:// 開頭');
        const text = String(b.text || ''); if (kind !== 'url' && !text.trim()) throw new Error('內容是空的');
        if (text.length > MAX_MATERIAL) throw new Error(`內容超過 ${MAX_MATERIAL.toLocaleString()} 字，請只放需要的部分`);
        const m = { id: uid(), kind, title: String(b.title || (kind === 'url' ? url : '資料')).trim().slice(0, 80), text, url: kind === 'url' ? url : '', at: Date.now(),
          fileName: kind === 'file' ? outputs.slug(b.fileName || b.title || 'material') + (/\.[\w]{1,5}$/.test(b.fileName || '') ? '' : '.txt') : '',
          share: b.share === 'all' || !Array.isArray(b.share) ? 'all' : b.share.filter(k => S.ais[k]), auto: b.auto !== false };
        if (m.kind === 'file' && /\.[\w]{1,5}$/.test(b.fileName || '')) m.fileName = outputs.slug(String(b.fileName).replace(/\.[\w]{1,5}$/, '')) + String(b.fileName).match(/\.[\w]{1,5}$/)[0].toLowerCase();
        (p.materials = p.materials || []).push(m); store.save(); return { materials: p.materials };
      }
      case '/api/materials/update': {
        const m = p && (p.materials || []).find(x => x.id === b.id); if (!m) throw new Error('找不到這份資料');
        if (typeof b.title === 'string') m.title = b.title.trim().slice(0, 80) || m.title;
        if (b.share === 'all' || Array.isArray(b.share)) m.share = b.share === 'all' ? 'all' : b.share.filter(k => S.ais[k]);
        if (typeof b.auto === 'boolean') m.auto = b.auto;
        store.save(); return { materials: p.materials };
      }
      case '/api/materials/delete': if (p) { p.materials = (p.materials || []).filter(x => x.id !== b.id); store.save(); } return { materials: p ? p.materials : [] };
      case '/api/relay/save': {
        const name = String(b.name || '').trim().slice(0, 40); if (!name) throw new Error('請輸入範本名稱');
        const stages = (b.stages || []).slice(0, 8).map(x => ({ role: String(x.role || '').slice(0, 40), ai: S.ais[x.ai] ? x.ai : '', task: String(x.task || '').slice(0, 2000), accept: String(x.accept || '').slice(0, 1000), input: ['previous', 'all', 'question'].includes(x.input) ? x.input : 'previous' }));
        if (!stages.length) throw new Error('範本至少要有一棒');
        S.relayTemplates = (S.relayTemplates || defaultRelays()).filter(x => x.name !== name); S.relayTemplates.push({ name, stages });
        store.save(); return { relayTemplates: S.relayTemplates };
      }
      case '/api/relay/delete': S.relayTemplates = (S.relayTemplates || defaultRelays()).filter(x => x.name !== b.name); store.save(); return { relayTemplates: S.relayTemplates };
      case '/api/attachments/add': {
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        const mime = String(b.mime || ''), ext = IMG_TYPES[mime]; if (!ext) throw new Error('只接受 PNG、JPG、WebP、GIF 圖片');
        const buf = Buffer.from(String(b.data || ''), 'base64'); if (!buf.length) throw new Error('圖片是空的');
        if (buf.length > 10 * 1024 * 1024) throw new Error('圖片超過 10 MB');
        const sig = buf.slice(0, 12).toString('hex');   // 確認檔案內容真的是宣稱的圖片格式
        const okSig = { '.png': sig.startsWith('89504e47'), '.jpg': sig.startsWith('ffd8ff'), '.gif': sig.startsWith('47494638'), '.webp': sig.startsWith('52494646') && sig.slice(16, 24) === '57454250' }[ext];
        if (!okSig) throw new Error('檔案內容不是宣稱的圖片格式');
        const id = uid(), file = id + ext, d = attachDir(p.id, c.id); fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, file), buf);
        const a = { id, name: String(b.name || file).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80), file, path: path.join(d, file), mime, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), at: Date.now() };
        (c.attachments = c.attachments || []).push(a); store.save();
        const { path: _p, ...pub } = a; return { attachment: pub };
      }
      case '/api/attachments/delete': {
        const c = findC(p, b.cid), a = c && (c.attachments || []).find(x => x.id === b.id); if (!a) return;
        fs.rmSync(a.path, { force: true }); c.attachments = c.attachments.filter(x => x !== a); store.save(); return;
      }
      case '/api/models': {
        const a = S.ais[b.id], P = a && providers.PROVIDERS[a.provider]; if (!P) throw new Error('找不到這個 AI');
        const list = await Promise.resolve(P.models ? P.models() : []);
        return { models: list.map(x => (typeof x === 'string' ? { id: x, name: x } : x)), note: P.modelNote || '' };
      }
      case '/api/ais/add': {   // 新增席位：同一家 AI 用不同模型或角色多坐一位
        const prov = ['claude', 'codex', 'gemini', 'grok'].includes(b.provider) ? b.provider : null; if (!prov) throw new Error('請選擇 AI 類型');
        const id = 'seat' + uid().slice(-8);
        S.ais[id] = { ...DEFAULT_AIS()[{ codex: 'chatgpt', claude: 'claude', gemini: 'gemini', grok: 'grok' }[prov]], name: String(b.name || '').trim().slice(0, 30) || '新席位', model: String(b.model || '').trim().slice(0, 80), role: String(b.role || '').trim().slice(0, 300), ack: false };
        store.save(); return stateView();
      }
      case '/api/ais/delete': {
        if (DEFAULT_AIS()[b.id]) throw new Error('內建的四個 AI 不能刪除，可以改成手動貼上或不勾選');
        if (engine.busy) throw new Error('討論進行中，請等它結束');
        delete S.ais[b.id]; store.save(); return stateView();
      }
      case '/api/chat/tags': {
        const c = findC(p, b.cid); if (!c) throw new Error('找不到對話');
        c.tags = [...new Set((b.tags || []).map(x => String(x).trim().replace(/^#/, '').slice(0, 20)).filter(Boolean))].slice(0, 10); store.save(); return { tags: c.tags };
      }
      case '/api/step/favorite': {   // 收藏重要回答：和專案記憶分開，不會自動傳給 AI
        const c = findC(p, b.cid), t = c && c.turns.find(x => x.id === b.turnId), st = t && t.steps.find(x => x.id === b.stepId);
        if (!st) throw new Error('找不到這則回答'); st.favorite = !!b.on; store.save(); return { favorite: st.favorite };
      }
      case '/api/search': return { results: search(db(), { q: b.q, tag: b.tag, ai: b.ai, from: +b.from || 0, to: +b.to || 0, fav: !!b.fav, pid: b.allProjects === false ? b.pid : '' }) };
      case '/api/queue/add': {
        const Q = (db().queue = db().queue || []);
        const prob = engine.preview(b).problem; if (prob) throw Object.assign(new Error(prob.text), { code: prob.code });
        if (!b.cid) throw new Error('找不到對話');
        Q.push({ id: uid(), pid: b.pid, cid: b.cid, req: b, status: 'queued', at: Date.now() });
        store.save(); processQueue(); return { queue: db().queue.length };
      }
      case '/api/queue/cancel': { const q = (db().queue || []).find(x => x.id === b.id && x.status === 'queued'); if (q) { q.status = 'canceled'; q.endedAt = Date.now(); store.save(); } return; }
      case '/api/queue/clear': db().queue = (db().queue || []).filter(x => ['queued', 'running'].includes(x.status)); store.save(); return;
      case '/api/queue/resume': db().queuePaused = !!b.pause; for (const q of db().queue || []) if (q.status === 'interrupted') q.status = 'queued'; store.save(); processQueue(); return;
      case '/api/prefs/vote': {   // 匿名比較：只記錄你的偏好，不代表事實正確率
        const c = findC(p, b.cid), t = c && c.turns.find(x => x.id === b.turnId); if (!t) throw new Error('找不到這場討論');
        const pool = t.steps.filter(x => x.kind === 'answer' && x.round === (b.round | 0) && x.status === 'ok' && !x.superseded), win = pool.find(x => x.id === b.stepId);
        if (!win || pool.length < 2) throw new Error('至少要有兩個回答才能比較');
        (S.prefs = S.prefs || []).push({ at: Date.now(), task: String(b.task || '一般').slice(0, 20), winner: win.ai, others: pool.filter(x => x !== win).map(x => x.ai), turnId: t.id, round: b.round | 0 });
        t.votes = t.votes || {}; t.votes[b.round | 0] = win.id; store.save(); return { stats: prefStats(S) };
      }
      case '/api/prefs/stats': return { stats: prefStats(S) };
      case '/api/prefs/clear': S.prefs = []; store.save(); return { stats: prefStats(S) };
      case '/api/bye': if (open) setTimeout(() => { if (!engine.busy && Date.now() - lastHit > 4000) quit(); }, 6000); return;
    }
    throw new Error('未知的操作');
  }

  console.log(`AI圓桌會議 v${VERSION}（山姆蛋實驗室）已啟動：http://localhost:${actual}（這個視窗請保持開啟）`);
  console.log('資料位置：' + paths.dataDir + '（加密：' + store.state.encryption + '）');
  if (open) openWindow(actual);
  return { server, port: actual, token, store, engine, paths, quit };
}

// 依任務類型統計「你選它的比例」；不是正確率，也不代表某家 AI 客觀比較好
function prefStats(S) {
  const by = {};
  for (const v of S.prefs || []) {
    const t = (by[v.task] = by[v.task] || {});
    for (const ai of [v.winner, ...v.others]) { t[ai] = t[ai] || { seen: 0, chosen: 0 }; t[ai].seen++; }
    t[v.winner].chosen++;
  }
  return { total: (S.prefs || []).length, byTask: by };
}
// 安裝：先顯示來源網址並要求輸入 Y 才下載執行，不會無提示執行遠端腳本
function installScript(cmd) {
  const url = (cmd.match(/https:\/\/\S+/) || [])[0];
  if (!url) return `Write-Host '將執行：${cmd}'; if ((Read-Host '確認安裝請輸入 Y') -eq 'Y') { ${cmd} }`;
  return `Write-Host '將從官方網址下載並執行安裝程式：' -ForegroundColor Yellow; Write-Host '${url}'; Write-Host '本程式無法驗證這個腳本的內容，請確認網址是官方來源。'; if ((Read-Host '確認安裝請輸入 Y') -eq 'Y') { ${cmd} }`;
}
// 指令以 -EncodedCommand 傳入，避免 cmd 把引號或 | 誤解；指令只會來自 providers.js 寫死的清單
function openConsole(title, command) {
  const enc = Buffer.from(`$Host.UI.RawUI.WindowTitle = 'AI圓桌會議：${title.replace(/'/g, '')}'; ${command}`, 'utf16le').toString('base64');
  execFile('cmd', ['/c', 'start', '', 'powershell', '-NoProfile', '-NoExit', '-EncodedCommand', enc], { windowsHide: true }, () => {});
}
function openWindow(port) {
  if (process.platform !== 'win32') return;
  const url = `http://localhost:${port}`;
  exec(`start "" msedge --app=${url} --window-size=1300,880`, e => { if (e) execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }); });
}

if (require.main === module) main().catch(e => { console.log('錯誤：' + e.message); process.exit(1); });
module.exports = { main, VERSION };

// 多AI討論室 v2：專案、連續對話、專案記憶。Node.js 18+，不需安裝套件。
// 啟動：雙擊 start.bat，或在此資料夾執行 node server.js
const http = require('http'), fs = require('fs'), path = require('path'), { spawn, exec } = require('child_process');
const APP = process.argv.includes('--app');   // 軟體模式：開獨立視窗、關窗後自動結束
const PORT = 3456, ROOT = __dirname, WORK = path.join(ROOT, 'sandbox'), DBF = path.join(ROOT, 'data.json');
fs.mkdirSync(WORK, { recursive: true });

// ---------- 資料 ----------
const DEFAULT_AIS = {
  chatgpt: { name: 'ChatGPT', cmd: 'codex --search exec --skip-git-repo-check -s read-only -', role: '' },   // 與 setup.ps1 寫入的指令一致
  claude:  { name: 'Claude',  cmd: 'claude -p --max-turns 8 --allowedTools "WebSearch,WebFetch"', role: '' },
  grok:    { name: 'Grok',    cmd: '', role: '' },
  gemini:  { name: 'Gemini',  cmd: 'agy -p {prompt}', role: '' },
};
let db = { settings: { ais: DEFAULT_AIS }, projects: [] };
if (fs.existsSync(DBF)) db = JSON.parse(fs.readFileSync(DBF, 'utf8').replace(/^\uFEFF/, ''));
for (const k in DEFAULT_AIS) db.settings.ais[k] ??= DEFAULT_AIS[k];
// 舊預設換成新預設（使用者自己改過的指令不動）：--max-turns 1 一用工具（搜尋、讀技能）就超過回合上限，結束碼 1
const OLD_CMDS = { claude: ['claude -p --max-turns 1', 'claude -p --max-turns 10 --allowedTools WebSearch WebFetch'], chatgpt: ['codex exec --skip-git-repo-check -s read-only -'] };
for (const k in OLD_CMDS) if (OLD_CMDS[k].includes(db.settings.ais[k].cmd.trim())) db.settings.ais[k].cmd = DEFAULT_AIS[k].cmd;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
if (!db.projects.length) db.projects.push({ id: uid(), name: '預設專案', instructions: '', memory: '', chats: [] });
db.projects.forEach(p => p.chats.forEach(c => c.turns.forEach(t => {
  if (t.status === 'running') t.status = 'interrupted';
  t.msgs.forEach(m => { if (m.sum === undefined) { m.sum = t.ids.length > 1 && m.round > t.rounds; if (m.sum) m.round = null; } });  // 舊資料轉換
})));
function save() {
  const s = JSON.stringify(db, null, 1);
  try { fs.writeFileSync(DBF + '.tmp', s); fs.renameSync(DBF + '.tmp', DBF); } catch { fs.writeFileSync(DBF, s); }
}
save();
const findP = id => db.projects.find(p => p.id === id);

// ---------- 掃描各 AI 已安裝的技能（讀取 SKILL.md 的 name / description）----------
const os = require('os'), HOME = os.homedir();
const SKILL_DIRS = {
  chatgpt: [path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'skills'), path.join(HOME, '.agents', 'skills')],
  claude:  [path.join(HOME, '.claude', 'skills')],
  gemini:  [path.join(HOME, '.gemini', 'skills'), path.join(HOME, '.gemini', 'antigravity', 'skills'), path.join(HOME, '.gemini', 'antigravity-cli', 'skills')],
};
let skillCache = null, skillAt = 0;
function scanSkills() {
  if (skillCache && Date.now() - skillAt < 30000) return skillCache;
  const out = [], seen = new Set();
  const walk = (ai, dir, depth) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (list.some(f => f.isFile() && f.name.toLowerCase() === 'skill.md')) {
      let txt = ''; try { txt = fs.readFileSync(path.join(dir, list.find(f => f.name.toLowerCase() === 'skill.md').name), 'utf8'); } catch {}
      const fm = (txt.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || '';
      const get = k => ((fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').replace(/^["'>|]\s*|["']$/g, '').trim();
      const name = get('name') || path.basename(dir), key = ai + ':' + name;
      if (!seen.has(key)) { seen.add(key); out.push({ ai, name, desc: get('description').slice(0, 160), system: dir.includes('.system'), file: path.join(dir, list.find(f => f.name.toLowerCase() === 'skill.md').name) }); }
      return;
    }
    if (depth > 0) for (const f of list) if (f.isDirectory() && f.name !== 'node_modules') walk(ai, path.join(dir, f.name), depth - 1);
  };
  for (const ai in SKILL_DIRS) for (const d of SKILL_DIRS[ai]) walk(ai, d, 3);
  out.sort((a, b) => a.system - b.system || a.name.localeCompare(b.name));
  skillCache = out; skillAt = Date.now(); return out;
}
// 問題裡用 $名稱 指定、但這個 AI 沒安裝的技能 → 回傳要轉述的技能
function sharedFor(q, id) {
  const names = [...new Set([...String(q).matchAll(/\$([A-Za-z0-9][\w.-]*)/g)].map(m => m[1].replace(/[.]+$/, '')))];
  const all = scanSkills(), res = [];
  for (const n of names) {
    const owners = all.filter(x => x.name.toLowerCase() === n.toLowerCase());
    if (owners.length && !owners.some(x => x.ai === id)) res.push(owners[0]);
  }
  return res;
}
function skillText(sk) {
  let t = ''; try { t = fs.readFileSync(sk.file, 'utf8'); } catch { return ''; }
  return cut(t.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim(), 6000);
}
const findC = (p, id) => p && p.chats.find(c => c.id === id);
const cut = (s, n) => s.length > n ? s.slice(0, n) + '…（略）' : s;

// ---------- 呼叫 AI ----------
let run = null; // 目前進行中的討論
const decode = b => { const u = b.toString('utf8'); if (!u.includes('\uFFFD')) return u; try { return new TextDecoder('big5').decode(b); } catch { return u; } };
const kill = p => process.platform === 'win32' ? exec(`taskkill /pid ${p.pid} /T /F`) : p.kill();

// 指令裡有 {prompt}：提示當成參數傳入（例如 agy -p {prompt}）；沒有的話用 stdin 傳入。
function cli(cmd, input, ms = 300000) {
  return new Promise((res, rej) => {
    let p;
    if (cmd.includes('{prompt}')) {
      if (input.length > 30000) input = input.slice(0, 16000) + '\n…（中間內容過長已省略）…\n' + input.slice(-13000);   // Windows 命令列長度上限
      const args = (cmd.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, '')).map(a => a === '{prompt}' ? input : a);
      p = spawn(args[0], args.slice(1), { cwd: WORK, windowsHide: true });
      input = '';
    } else p = spawn(cmd, { cwd: WORK, shell: true, windowsHide: true });
    p.on('error', e => rej(new Error(e.code === 'ENOENT' ? `找不到指令 ${cmd.split(' ')[0]}，請確認已安裝並重開視窗` : e.message)));
    run?.procs.add(p);   // 設定精靈的測試不在討論中，run 是 null
    const out = [], err = [];
    const t = setTimeout(() => { kill(p); rej(new Error(`逾時（${Math.round(ms / 60000) || 1}分鐘）`)); }, ms);
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
    p.on('close', code => {
      clearTimeout(t); run?.procs.delete(p);
      const o = decode(Buffer.concat(out)).trim(), e = decode(Buffer.concat(err)).trim();
      code === 0 && o ? res(o) : rej(new Error(run?.stop ? '已中止' : (e || o).slice(-400) || '結束碼 ' + code));   // 有些 CLI（如 claude -p）把錯誤印在 stdout
    });
    p.stdin.on('error', () => {}); p.stdin.end(input);
  });
}

async function ask(id, prompt) {
  let cmd = db.settings.ais[id].cmd.trim();
  if (db.settings.ais[id].skills) cmd = cmd.replace(/-s\s+read-only/, '-s workspace-write');   // 允許技能：Codex 可在工作資料夾寫檔
  if (cmd) return cli(cmd, prompt);
  run.pending = { ai: id, prompt };                      // 手動貼上模式
  const text = await new Promise(r => run.resolve = r);
  run.pending = null; run.resolve = null;
  if (run.stop) throw new Error('已中止');
  return text;
}

// ---------- 設定精靈：偵測安裝、登入狀態、測試（安裝主要由 Setup.bat 負責，這裡補檢查與修復）----------
// install / login 只會執行這張表裡寫死的指令（與 setup.ps1 相同），不接受網頁傳來的內容
const SETUP = {
  chatgpt: { status: 'codex login status', install: 'npm install -g @openai/codex', login: 'codex login', page: 'https://github.com/openai/codex' },
  claude:  { status: 'claude auth status', install: 'irm https://claude.ai/install.ps1 | iex', login: 'claude auth login', page: 'https://code.claude.com/docs/en/setup' },
  gemini:  { install: 'irm https://antigravity.google/cli/install.ps1 | iex', login: 'agy', page: 'https://antigravity.google' },
  grok:    { install: 'irm https://x.ai/cli/install.ps1 | iex', login: 'grok' },
};
const sh = (cmd, ms = 15000) => new Promise(r => exec(cmd, { timeout: ms, windowsHide: true }, (e, o) => r({ ok: !e, out: decode(Buffer.from(o || '')).trim() })));
async function refreshPath() {   // 剛安裝完的 CLI 要讀新的 PATH 才找得到，不用重開
  if (process.platform !== 'win32') return;
  const r = await sh(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')"`);
  if (r.ok && r.out) process.env.Path = [...new Set([...r.out.split(';'), ...(process.env.Path || '').split(';')].filter(Boolean))].join(';');
}
async function checkAI(id) {
  const ai = db.settings.ais[id], s = SETUP[id] || {}, exe = (ai.cmd.trim().match(/^"[^"]+"|^\S+/) || [''])[0].replace(/"/g, '');
  const r = { id, name: ai.name, manual: !exe, exe, installed: false, path: '', loggedIn: null, canInstall: !!s.install, canLogin: !!s.login, page: s.page || '' };
  if (!exe || !/^[\w.:\\\/ -]+$/.test(exe)) return r;   // 只把單純的程式名稱交給 where
  const w = await sh(process.platform === 'win32' ? `where ${exe}` : `command -v ${exe}`);
  r.installed = w.ok && !!w.out; r.path = w.out.split(/\r?\n/)[0] || '';
  if (r.installed && s.status) { const st = await sh(s.status); r.loggedIn = st.ok && !/not logged in|"loggedIn":\s*false/i.test(st.out); }
  return r;
}
// 把 CLI 的原始錯誤翻成使用者看得懂的話，並建議下一步
function friendly(msg) {
  const m = String(msg);
  if (/找不到指令|ENOENT|not recognized|不是內部或外部命令/i.test(m)) return { kind: 'missing', text: '找不到這個 AI 的程式，可能還沒安裝。', action: 'install' };
  if (/not logged in|log ?in|sign ?in|authenticat|unauthori[sz]ed|401|credential|登入/i.test(m)) return { kind: 'login', text: '還沒登入，或登入已過期。', action: 'login' };
  if (/usage limit|rate limit|quota|limit reached|credit balance|429|too many requests/i.test(m)) return { kind: 'limit', text: '這個帳號的用量已達上限，請稍後再試或升級方案。' };
  if (/max turns/i.test(m)) return { kind: 'turns', text: '回合上限太低，AI 一用工具就停下。請到「AI 設定」把指令改成預設值。' };
  if (/逾時/.test(m)) return { kind: 'timeout', text: '等太久沒有回應，可能是網路問題或程式卡住。' };
  return { kind: 'other', text: '發生錯誤：' + m.slice(0, 200) };
}

function context(p, c, id, q = '') {
  const ai = db.settings.ais[id];
  let s = '你正在參與一個多AI討論室。' + (ai.skills
    ? '你可以使用你已安裝的技能，需要時可以讀取技能檔案、執行指令，產生的檔案請存在目前的工作資料夾，並在回答中說明檔名。不要修改工作資料夾以外的任何檔案。使用者若用「$技能名稱」指定技能，請使用該技能。'
    : '只用文字回答，不要讀寫檔案或執行指令。') + '如果你能上網，遇到需要最新資訊或查證的內容請先搜尋，並在文末附上來源網址。回答要具體、有條理，不要客套。\n';
  if (ai.role) s += `你的角色：${ai.role}\n`;
  if (p.instructions) s += `\n【專案說明】\n${p.instructions}\n`;
  if (p.memory) s += `\n【專案記憶】\n${p.memory}\n`;
  const prev = c.turns.filter(t => t.status === 'done').slice(-8);
  if (prev.length) s += '\n【本對話先前的內容】\n' + prev.map(t => `使用者問：${t.q}\n結論：${cut(t.summary || '（無）', 1500)}`).join('\n\n') + '\n';
  if (/https?:\/\//.test(q)) s += '\n【關於網址】使用者的問題裡有網址。請先開啟並閱讀這些網頁再回答，並說明你讀到的重點。如果你無法上網或打不開，請明確說「我沒有讀到這個網頁」，不要假裝讀過或憑網址猜內容。\n';
  for (const sk of sharedFor(q, id)) {
    const body = skillText(sk); if (!body) continue;
    s += `\n【技能轉述：$${sk.name}】\n使用者指定了「$${sk.name}」技能。這個技能安裝在 ${db.settings.ais[sk.ai]?.name || sk.ai}，你沒有安裝，以下是它的說明內容。請依照其中的原則、步驟與規範來回答；其中提到的腳本、檔案或素材你無法使用，略過即可。\n${body}\n【技能轉述結束】\n`;
  }
  return s;
}

// 討論模式：r1 = 第一輪指示，rn = 之後每輪，sum = 主持人總結
const MODES = {
  discuss: { r1: () => '請獨立提出你的看法與建議。',
    rn: () => '請指出對方的優點、漏洞與需要查證之處，然後給出你修正後的立場。',
    sum: '請整理：1) 結論與建議採用的方案 2) 仍有分歧之處 3) 需要查證或由使用者決定的事項。' },
  debate: { r1: i => ['你是正方。請盡力論證支持的理由。', '你是反方。請盡力論證反對的理由與風險。'][i] || '你是評審。請中立分析正反雙方可能的論點。',
    rn: i => i < 2 ? '請回應對方的論點，指出它的弱點，並強化你的立場。' : '請比較雙方論點的強弱，指出誰的論證更有說服力與原因。',
    sum: '請整理：1) 雙方最有力的論點 2) 你的判斷與理由 3) 使用者做決定前需要確認的事。' },
  brainstorm: { r1: () => '請提出 5 個彼此差異很大的點子，每個用一兩句說明亮點。',
    rn: () => '看完其他AI的點子，請延伸或組合出更好的新點子，並從全部點子中選出你認為最好的 3 個與理由。',
    sum: '請整理：1) 最值得採用的前 3 個點子與理由 2) 可以組合的點子 3) 下一步要驗證什麼。' },
  review: { r1: () => '請給出你的答案，並標明你不確定的地方。',
    rn: () => '請以嚴格審查者的角度檢查其他AI的答案：找出事實錯誤、邏輯漏洞與遺漏的風險，再給出你修正後的答案。',
    sum: '請整理：1) 經過審查後最可靠的答案 2) 被指出的錯誤是否成立 3) 仍不確定、需要查證的事項。' },
};

// fromRound：從第幾輪開始（「再討論一輪」時從現有輪數 +1 開始）
async function discuss(p, c, turn, fromRound = 1) {
  const { q, mod, ids } = turn, solo = ids.length === 1, M = MODES[turn.mode] || MODES.discuss;
  const name = id => db.settings.ais[id].name;
  const of = r => turn.msgs.filter(m => m.round === r && !m.sum && !m.error);
  const go = async (id, r, task, sum) => {
    if (run.stop) return;
    run.busy.set(id, { since: Date.now(), r: sum ? 'sum' : r });
    const t0 = Date.now(), m = { round: sum ? null : r, ai: id, sum: !!sum };
    try { m.text = await ask(id, context(p, c, id, q) + '\n' + task); } catch (e) { m.error = e.message; }
    m.ms = Date.now() - t0; turn.msgs.push(m);
    run.busy.delete(id); c.updated = Date.now(); save();
  };
  const batch = async (r, mk) => {
    const auto = ids.filter(i => db.settings.ais[i].cmd.trim()), man = ids.filter(i => !auto.includes(i));
    const a = Promise.all(auto.map(i => go(i, r, mk(i))));  // 自動的同時進行，手動的依序貼上
    for (const i of man) await go(i, r, mk(i));
    await a;
  };
  for (let r = fromRound; r <= turn.rounds && !run.stop; r++) {
    await batch(r, id => {
      const i = ids.indexOf(id);
      if (r === 1) return `【這次的問題】\n${q}\n\n${solo ? '請回答。' : M.r1(i)}`;
      const others = of(r - 1).filter(m => m.ai !== id).map(m => `【${name(m.ai)}】\n${m.text}`).join('\n\n') || '（無）';
      const mine = (of(r - 1).find(m => m.ai === id) || {}).text || '（無）';
      return `【這次的問題】\n${q}\n\n【其他AI上一輪的發言】\n${others}\n\n【你上一輪的發言】\n${mine}\n\n${solo ? '請補充或修正你的回答。' : M.rn(i)}`;
    });
  }
  const last = of(turn.rounds);
  if (solo) turn.summary = (last[0] || {}).text || turn.summary || '';
  else if (!run.stop && last.length) {
    turn.msgs.forEach(m => { if (m.sum) m.old = true; });   // 舊的總結保留但標為過期
    const all = last.map(m => `【${name(m.ai)}】\n${m.text}`).join('\n\n');
    await go(mod, null, `【這次的問題】\n${q}\n\n【最後一輪各AI的發言】\n${all}\n\n你是主持人。${M.sum}`, true);
    const s = turn.msgs.filter(m => m.sum && !m.old && !m.error).pop();
    if (s) turn.summary = s.text;
  }
  turn.status = run.stop ? 'stopped' : 'done';
}

function startRun(p, c, turn, fromRound) {
  turn.status = 'running'; c.updated = Date.now(); save();
  run = { pid: p.id, cid: c.id, stop: false, procs: new Set(), busy: new Map(), pending: null, resolve: null, at: Date.now() };
  discuss(p, c, turn, fromRound).catch(e => { turn.status = 'error'; turn.err = e.message; }).finally(() => { save(); run = null; });
}

// ---------- 網頁伺服器 ----------
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

let lastHit = Date.now();
const URL0 = 'http://localhost:' + PORT;
// 只接受 AI圓桌會議 自己的視窗：Host 擋 DNS rebinding、Origin 擋其他網頁、token 只寫在我們送出的頁面裡（每次啟動都換）
const TOKEN = require('crypto').randomBytes(24).toString('hex'), HOSTS = new Set(['localhost:' + PORT, '127.0.0.1:' + PORT]);
const trusted = (req, u) => HOSTS.has(req.headers.host)
  && (!req.headers.origin || HOSTS.has(req.headers.origin.replace(/^http:\/\//, '')))
  && (!u.pathname.startsWith('/api/') || (req.headers['x-rt-token'] || u.searchParams.get('t')) === TOKEN);
function openWindow() {
  if (process.platform !== 'win32') return;
  if (APP) exec(`start "" msedge --app=${URL0} --window-size=1300,880`, e => { if (e) exec(`start "" ${URL0}`); });
  else exec(`start "" ${URL0}`);
}
if (APP) setInterval(() => { if (!run && Date.now() - lastHit > 150000) process.exit(0); }, 10000);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), url = u.pathname;
  if (!trusted(req, u)) { res.writeHead(403); return res.end(); }
  lastHit = Date.now();
  const send = (o, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  try {
    if (url === '/') return send(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('<meta charset="utf-8">', `$&\n<meta name="rt-token" content="${TOKEN}">`), 'text/html');
    if (req.method === 'GET') {
      if (url === '/api/skills') { if (u.searchParams.get('refresh')) skillCache = null; return send(scanSkills()); }
      if (url === '/api/projects') return send({
        settings: db.settings,
        projects: db.projects.map(p => ({ ...p, chats: p.chats.map(c => ({ id: c.id, title: c.title, updated: c.updated })).sort((a, b) => b.updated - a.updated) })),
      });
      if (url === '/api/chat') {
        const c = findC(findP(u.searchParams.get('pid')), u.searchParams.get('cid'));
        return send({ chat: c || null, now: Date.now(), run: run && { pid: run.pid, cid: run.cid, at: run.at, busy: [...run.busy], pending: run.pending } });
      }
      return send({ error: 'not found' });
    }
    const b = await body(req), p = findP(b.pid);
    switch (url) {
      case '/api/project/new': { const n = { id: uid(), name: b.name || '新專案', instructions: '', memory: '', chats: [] }; db.projects.unshift(n); save(); return send({ id: n.id }); }
      case '/api/project/update': if (p) { for (const f of ['name', 'instructions', 'memory']) if (typeof b[f] === 'string') p[f] = b[f]; save(); } break;
      case '/api/project/delete':
        if (run && run.pid === b.pid) return send({ error: '這個專案正在討論中' });
        db.projects = db.projects.filter(x => x.id !== b.pid);
        if (!db.projects.length) db.projects.push({ id: uid(), name: '預設專案', instructions: '', memory: '', chats: [] });
        save(); break;
      case '/api/chat/new': { if (!p) return send({ error: '找不到專案' }); const c = { id: uid(), title: '新對話', updated: Date.now(), turns: [] }; p.chats.push(c); save(); return send({ id: c.id }); }
      case '/api/chat/delete':
        if (run && run.cid === b.cid) return send({ error: '這個對話正在討論中' });
        if (p) { p.chats = p.chats.filter(c => c.id !== b.cid); save(); } break;
      case '/api/memory/add': if (p && b.text) { p.memory = (p.memory ? p.memory + '\n\n' : '') + b.text; save(); } break;
      case '/api/settings':
        for (const k in b.ais || {}) if (db.settings.ais[k]) { for (const f of ['cmd', 'role']) if (typeof b.ais[k][f] === 'string') db.settings.ais[k][f] = b.ais[k][f].trim();
          if (typeof b.ais[k].skills === 'boolean') db.settings.ais[k].skills = b.ais[k].skills; }
        save(); break;
      case '/api/send': {
        if (run) return send({ error: '已有討論在進行中，請等它結束或按中止' });
        const c = findC(p, b.cid), ids = (b.ids || []).filter(i => db.settings.ais[i]);
        if (!c || !b.q?.trim() || !ids.length) return send({ error: '資料不完整' });
        const solo = ids.length === 1;
        const turn = { q: b.q.trim(), ids, mode: MODES[b.mode] ? b.mode : 'discuss', rounds: solo ? 1 : Math.max(1, Math.min(4, b.rounds | 0)), mod: solo ? ids[0] : (db.settings.ais[b.mod] ? b.mod : ids[0]), msgs: [], at: Date.now() };
        if (!c.turns.length) c.title = turn.q.slice(0, 24);
        const sh = {}; for (const id of ids) for (const sk of sharedFor(turn.q, id)) (sh[sk.name] = sh[sk.name] || { from: sk.ai, to: [] }).to.push(id);
        if (Object.keys(sh).length) turn.shared = sh;
        c.turns.push(turn); startRun(p, c, turn, 1);
        break;
      }
      case '/api/continue': {   // 對最後一題再討論一輪
        if (run) return send({ error: '已有討論在進行中' });
        const c = findC(p, b.cid), turn = c && c.turns[c.turns.length - 1];
        if (!turn || turn.ids.length < 2) return send({ error: '只有多個 AI 的討論才能再加一輪' });
        turn.rounds += 1; startRun(p, c, turn, turn.rounds);
        break;
      }
      case '/api/chat/rename': { const c = findC(p, b.cid); if (c && b.title?.trim()) { c.title = b.title.trim().slice(0, 60); save(); } break; }
      case '/api/manual': if (run && run.resolve) run.resolve(b.text || '（空白）'); break;
      case '/api/setup/check': await refreshPath(); return send(await Promise.all(Object.keys(db.settings.ais).map(checkAI)));
      case '/api/setup/test': {
        const ai = db.settings.ais[b.id]; if (!ai || !ai.cmd.trim()) return send({ ok: false, text: '這個 AI 是手動貼上模式，不需要測試。' });
        const t0 = Date.now();
        try { const out = await cli(ai.cmd.trim(), '這是連線測試。只回覆 OK 兩個字，不要使用任何工具。', 90000); return send({ ok: true, text: `連線成功（${Math.round((Date.now() - t0) / 1000)} 秒）：${out.slice(0, 60)}` }); }
        catch (e) { return send({ ok: false, ...friendly(e.message) }); }
      }
      case '/api/setup/open': {
        const s = SETUP[b.id]; if (!s || process.platform !== 'win32') break;
        if (b.action === 'page' && s.page) exec(`start "" "${s.page}"`);
        else if (s[b.action] && ['install', 'login'].includes(b.action))
          exec(`start "AI圓桌會議：${db.settings.ais[b.id].name}" powershell -NoProfile -NoExit -Command "${s[b.action]}"`);
        break;
      }
      case '/api/setup/done': db.settings.setupDone = true; save(); break;
      case '/api/open-work': if (process.platform === 'win32') exec(`start "" "${WORK}"`); break;
      case '/api/bye': if (APP) setTimeout(() => { if (!run && Date.now() - lastHit > 4000) process.exit(0); }, 6000); break;
      case '/api/stop': if (run) { run.stop = true; run.procs.forEach(kill); if (run.resolve) run.resolve(''); } break;
    }
    send({ ok: true });
  } catch (e) { send({ error: e.message }); }
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    if (APP) { openWindow(); setTimeout(() => process.exit(0), 1500); }   // 已經在執行：直接打開視窗
    else console.log('\n錯誤：討論室已經有一個在執行（可能是舊版）。\n請先關掉它，再重新開啟。\n');
  } else console.log('錯誤：' + e.message);
}).listen(PORT, '127.0.0.1', () => {
  console.log('AI圓桌會議 v1.0（山姆蛋實驗室）已啟動：' + URL0 + '（這個視窗請保持開啟）');
  openWindow();
});

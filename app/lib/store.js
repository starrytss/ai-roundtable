// 資料儲存：載入、格式遷移、加密存檔、版本化備份、還原、匯出匯入、保存期限
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const cs = require('./crypto-store');
const { computeStatus } = require('./status');

const SCHEMA = 2, KEEP_BACKUPS = 20, DAY = 86400000;
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

const DEFAULT_AIS = () => ({
  chatgpt: { name: 'ChatGPT', provider: 'codex', mode: 'auto', level: 'web', role: '', model: '', cmd: '', ack: false },
  claude: { name: 'Claude', provider: 'claude', mode: 'auto', level: 'web', role: '', model: '', cmd: '', ack: false },
  grok: { name: 'Grok', provider: 'grok', mode: 'manual', level: 'web', role: '', model: '', cmd: '', ack: false },
  gemini: { name: 'Gemini', provider: 'gemini', mode: 'auto', level: 'web', role: '', model: '', cmd: '', ack: false },
});
const DEFAULT_SETTINGS = () => ({
  ais: DEFAULT_AIS(), setupDone: false,
  privacy: { encryption: 'on', retentionDays: 0, redact: true, reduceTraffic: true },
  limits: { maxCalls: 20, maxRetries: 2, timeoutMin: 10, budgetChars: 24000 },
});
const newProject = name => ({ id: uid(), name: name || '預設專案', instructions: '', memory: '', memories: [], chats: [] });
const emptyDb = () => ({ schema: SCHEMA, settings: DEFAULT_SETTINGS(), projects: [newProject()] });

// ---------- v1.0 → v2 遷移 ----------
const EXE = { chatgpt: 'codex', claude: 'claude', gemini: 'agy', grok: 'grok' };
const PROVIDER = { chatgpt: 'codex', claude: 'claude', gemini: 'gemini', grok: 'grok' };
function migrateAi(key, old = {}) {
  const def = DEFAULT_AIS()[key] || { name: old.name || key, provider: 'custom', mode: 'auto', level: 'web', role: '', model: '', cmd: '', ack: false };
  if (old.provider) return { ...def, ...old };              // 已經是新格式
  const cmd = String(old.cmd || '').trim(), exe = (cmd.match(/^"[^"]+"|^\S+/) || [''])[0].replace(/"/g, '');
  const ai = { ...def, name: old.name || def.name, role: old.role || '', legacyCmd: cmd || undefined };
  if (!cmd) ai.mode = 'manual';
  else if (EXE[key] && path.basename(exe).replace(/\.(exe|cmd)$/i, '').toLowerCase() === EXE[key]) { ai.mode = 'auto'; ai.provider = PROVIDER[key]; }
  else { ai.mode = 'auto'; ai.provider = 'custom'; ai.cmd = cmd; }   // 使用者自訂的指令保留在「進階」
  ai.level = old.skills ? 'write' : 'web';
  return ai;
}
function migrateTurn(t) {
  if (t.steps) return t;
  const steps = (t.msgs || []).map((m, i) => ({
    id: uid() + i, kind: m.sum ? 'summary' : 'answer', round: m.sum ? null : m.round, ai: m.ai,
    status: m.error ? 'error' : 'ok', text: m.text || '', error: m.error ? { kind: 'other', text: m.error } : null,
    ms: m.ms || 0, superseded: !!m.old, events: [],
  }));
  const n = { id: t.id || uid(), q: t.q, at: t.at, mode: t.mode || 'discuss', rounds: t.rounds || 1, ids: t.ids || [], mod: t.mod || (t.ids || [])[0],
    modOutside: !!t.mod && !(t.ids || []).includes(t.mod), shared: t.shared, summary: t.summary || '', steps, legacy: true };
  if (t.status === 'running' || t.status === 'interrupted') { n.status = 'interrupted'; n.reasons = [{ code: 'interrupted' }]; }
  else if (t.status === 'stopped') { n.stopped = true; Object.assign(n, computeStatus(n)); }
  else Object.assign(n, computeStatus(n));
  return n;
}
function migrate(db) {
  const from = db.schema || 1;
  if (from > SCHEMA) throw new Error(`資料格式版本 ${from} 比這個程式新，請更新 AI圓桌會議`);
  const s = db.settings || {}, def = DEFAULT_SETTINGS();
  const ais = {};
  for (const k of new Set([...Object.keys(def.ais), ...Object.keys(s.ais || {})])) ais[k] = migrateAi(k, (s.ais || {})[k]);
  const out = {
    schema: SCHEMA,
    settings: { ...def, ...s, ais, privacy: { ...def.privacy, ...(s.privacy || {}) }, limits: { ...def.limits, ...(s.limits || {}) } },
    projects: (db.projects || []).map(p => ({ ...newProject(p.name), ...p, memories: p.memories || [],
      chats: (p.chats || []).map(c => ({ ...c, turns: (c.turns || []).map(migrateTurn) })) })),
  };
  if (!out.projects.length) out.projects.push(newProject());
  return { db: out, from };
}

// ---------- 儲存 ----------
function writeAtomic(file, buf) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, buf); fs.rmSync(tmp, { force: true }); }
}
const stamp = now => new Date(now).toISOString().replace(/[:.]/g, '-');

function openStore(paths, { protector = cs.dpapiProtector(), now = () => Date.now() } = {}) {
  fs.mkdirSync(paths.dataDir, { recursive: true }); fs.mkdirSync(paths.backupDir, { recursive: true });
  const state = { encryption: 'off', encryptionError: '', recovered: null, legacyImported: null, legacyPlaintext: null, migratedFrom: null };
  let key = null, db = null;

  const tryKey = () => { try { key = cs.loadOrCreateKey(paths.keyFile, protector); return true; } catch (e) { key = null; state.encryptionError = e.message; return false; } };
  const pack = obj => { const plain = Buffer.from(JSON.stringify(obj)); return key ? cs.seal(key, plain) : plain; };
  const unpack = buf => JSON.parse((cs.isSealed(buf) ? cs.open(key, buf) : buf).toString('utf8').replace(/^﻿/, ''));

  function backup(reason = 'manual') {
    if (!db) return null;
    const name = `${stamp(now())}-${reason.replace(/[^\w-]/g, '')}.rtb`;
    writeAtomic(path.join(paths.backupDir, name), pack(db));
    const all = listBackups();
    for (const b of all.slice(KEEP_BACKUPS)) fs.rmSync(path.join(paths.backupDir, b.name), { force: true });
    return name;
  }
  function listBackups() {
    let names = []; try { names = fs.readdirSync(paths.backupDir).filter(n => n.endsWith('.rtb')); } catch {}
    return names.sort().reverse().map(name => { const st = fs.statSync(path.join(paths.backupDir, name)); return { name, size: st.size, at: st.mtimeMs, reason: name.replace(/^.*?-(?=[a-z]+\.rtb$)/i, '').replace('.rtb', '') }; });
  }
  function readBackup(name) {
    if (!/^[\w.-]+\.rtb$/.test(name)) throw new Error('備份名稱不正確');
    return unpack(fs.readFileSync(path.join(paths.backupDir, name)));
  }

  function save() {
    if (key) {
      const buf = pack(db);
      writeAtomic(paths.encFile, buf);
      if (fs.existsSync(paths.plainFile)) fs.rmSync(paths.plainFile, { force: true });   // 加密成功後移除自己的明文檔
    } else writeAtomic(paths.plainFile, Buffer.from(JSON.stringify(db)));
  }

  // 1) 讀取：加密檔 → 明文檔 → v1.0 程式資料夾的舊資料 → 全新
  const wantEnc = () => (db ? db.settings.privacy.encryption : 'on') !== 'off';
  let raw = null, source = null;
  if (fs.existsSync(paths.encFile)) {
    if (!tryKey()) throw Object.assign(new Error('無法解開資料金鑰（DPAPI）：' + state.encryptionError + '。資料沒有被修改，請確認是用原本的 Windows 帳戶開啟。'), { code: 'KEY' });
    try { raw = unpack(fs.readFileSync(paths.encFile)); source = 'enc'; }
    catch (e) { state.recovered = { file: 'data.enc', error: e.message }; }
  } else if (fs.existsSync(paths.plainFile)) {
    try { raw = unpack(fs.readFileSync(paths.plainFile)); source = 'plain'; }
    catch (e) { state.recovered = { file: 'data.json', error: e.message }; }
  } else if (paths.legacyData && fs.existsSync(paths.legacyData)) {
    try { raw = JSON.parse(fs.readFileSync(paths.legacyData, 'utf8').replace(/^﻿/, '')); source = 'legacy'; }
    catch (e) { state.legacyError = `舊版資料 ${paths.legacyData} 無法讀取（${e.message}），檔案保留原狀`; }
  }
  // 2) 損壞：把壞檔留著改名，從最新的可用備份還原
  if (state.recovered) {
    if (!key) tryKey();
    const bad = state.recovered.file === 'data.enc' ? paths.encFile : paths.plainFile;
    const kept = bad + '.corrupt-' + stamp(now());
    fs.renameSync(bad, kept); state.recovered.keptAs = path.basename(kept);
    for (const b of listBackups()) { try { raw = readBackup(b.name); state.recovered.from = b.name; break; } catch {} }
    if (!raw) state.recovered.from = null;
  }
  const m = migrate(raw || emptyDb());
  db = m.db; if (raw && m.from < SCHEMA) state.migratedFrom = m.from;

  // 3) 加密
  if (wantEnc()) { if (key || tryKey()) state.encryption = 'on'; else state.encryption = 'failed'; }
  else { key = null; state.encryption = 'off'; }
  if (state.migratedFrom && source !== 'legacy') { db = raw; backup('before-migrate'); db = m.db; }
  save();

  // 4) v1.0 舊資料：確認新檔可讀回且內容相同，才把明文舊檔改名（不刪除，讓使用者決定）
  if (source === 'legacy') {
    const check = key ? unpack(fs.readFileSync(paths.encFile)) : unpack(fs.readFileSync(paths.plainFile));
    if (JSON.stringify(check) === JSON.stringify(db)) {
      const to = paths.legacyData + '.legacy-plaintext';
      try { fs.renameSync(paths.legacyData, to); state.legacyPlaintext = to; } catch (e) { state.legacyPlaintext = paths.legacyData; }
      state.legacyImported = paths.legacyData;
      backup('imported-v1');
    }
  }
  const last = listBackups()[0];
  if (!last || now() - last.at > DAY) backup('daily');

  return {
    get db() { return db; }, state, paths, save, backup, listBackups,
    restore(name) { const data = readBackup(name); backup('before-restore'); db = migrate(data).db; save(); return db; },
    setEncryption(on) {
      db.settings.privacy.encryption = on ? 'on' : 'off';
      if (on) { state.encryption = key || tryKey() ? 'on' : 'failed'; }
      else { key = null; state.encryption = 'off'; }
      save(); if (!on && fs.existsSync(paths.encFile)) fs.rmSync(paths.encFile, { force: true });
      return state.encryption;
    },
    exportData({ password } = {}) {
      const plain = Buffer.from(JSON.stringify(db, null, 1));
      return password ? cs.exportSeal(password, plain) : plain;
    },
    importData(buf, { password } = {}) {
      const plain = cs.isExport(buf) ? cs.exportOpen(password, buf) : buf;
      const data = JSON.parse(plain.toString('utf8').replace(/^﻿/, ''));
      if (!data || !Array.isArray(data.projects)) throw new Error('不是 AI圓桌會議 的資料檔');
      backup('before-import'); db = migrate(data).db; save(); return db;
    },
    purgeExpired(days = db.settings.privacy.retentionDays) {
      if (!days) return 0;
      const cut = now() - days * DAY; let n = 0;
      for (const p of db.projects) { const keep = p.chats.filter(c => (c.updated || 0) >= cut); n += p.chats.length - keep.length; p.chats = keep; }
      if (n) save();
      return n;
    },
    deleteLegacyPlaintext() {
      if (state.legacyPlaintext && fs.existsSync(state.legacyPlaintext) && state.legacyPlaintext.endsWith('.legacy-plaintext')) { fs.rmSync(state.legacyPlaintext); state.legacyPlaintext = null; return true; }
      return false;
    },
  };
}

module.exports = { openStore, migrate, emptyDb, newProject, uid, DEFAULT_AIS, SCHEMA };

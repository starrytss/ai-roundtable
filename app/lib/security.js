// 本機 API 保護與單一執行個體：只聽 127.0.0.1、每次啟動換 token、檢查 Host 與 Origin；
// 關閉舊的執行個體前先確認它真的是 AI圓桌會議（身分與鎖定檔裡的密碼都要對），不會結束其他程式
const fs = require('fs'), crypto = require('crypto'), http = require('http');

const newToken = () => crypto.randomBytes(24).toString('hex');
const hostsFor = port => new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
function trusted(req, u, { token, hosts }) {
  if (!hosts.has(req.headers.host)) return false;                                   // 擋 DNS rebinding
  const o = req.headers.origin;
  if (o && !hosts.has(o.replace(/^http:\/\//, ''))) return false;                   // 擋其他網頁
  if (u.pathname.startsWith('/api/')) return (req.headers['x-rt-token'] || u.searchParams.get('t')) === token;
  return true;
}
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
};

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function getJSON(port, path, headers = {}, method = 'GET', ms = 2000) {
  return new Promise(res => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers }, timeout: ms }, s => {
      let b = ''; s.on('data', d => b += d); s.on('end', () => { try { res({ status: s.statusCode, body: JSON.parse(b) }); } catch { res({ status: s.statusCode, body: null }); } });
    });
    r.on('error', () => res(null)); r.on('timeout', () => { r.destroy(); res(null); }); r.end();
  });
}
const readLock = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// 目前有沒有一個「確定是 AI圓桌會議」的執行個體
async function findRunning(lockFile) {
  const l = readLock(lockFile);
  if (!l || !alive(l.pid)) return null;
  const r = await getJSON(l.port, '/__identity');
  return r && r.body && r.body.app === 'ai-roundtable' && r.body.instance === l.instance ? l : null;
}
// 請舊的執行個體自己結束；身分不符就不動它
async function stopRunning(lockFile, { waitMs = 8000 } = {}) {
  const l = await findRunning(lockFile);
  if (!l) return { stopped: false, reason: 'none' };
  const r = await getJSON(l.port, '/__shutdown', { 'X-RT-Secret': l.secret }, 'POST');
  if (!r || r.status !== 200) return { stopped: false, reason: 'refused' };
  for (const t0 = Date.now(); Date.now() - t0 < waitMs;) { if (!alive(l.pid)) return { stopped: true }; await new Promise(x => setTimeout(x, 200)); }
  return { stopped: false, reason: 'timeout' };
}
function writeLock(lockFile, port) {
  const l = { app: 'ai-roundtable', pid: process.pid, port, instance: crypto.randomBytes(8).toString('hex'), secret: crypto.randomBytes(24).toString('hex'), startedAt: Date.now() };
  fs.writeFileSync(lockFile, JSON.stringify(l));
  return l;
}
function clearLock(lockFile, lock) { const l = readLock(lockFile); if (l && l.instance === lock.instance) fs.rmSync(lockFile, { force: true }); }

module.exports = { newToken, hostsFor, trusted, SECURITY_HEADERS, findRunning, stopRunning, writeLock, clearLock, readLock, alive };

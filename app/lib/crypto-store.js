// 本機資料加密：隨機產生的 AES-256-GCM 資料金鑰，用 Windows DPAPI（目前使用者帳戶）保護後存檔。
// 限制：同一個 Windows 帳戶下執行的惡意程式一樣能呼叫 DPAPI 解密，這只能防止檔案被複製到別台電腦或別的帳戶讀取。
const crypto = require('crypto'), fs = require('fs'), { spawnSync } = require('child_process');

const ENC_MAGIC = 'RTENC1\n', EXP_MAGIC = 'RTEXP1\n';

// 金鑰透過 stdin 傳給 PowerShell，不出現在命令列參數
function dpapi(op, buf) {
  const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());`
    + `$o=[Security.Cryptography.ProtectedData]::${op}($b,$null,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($o))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { input: buf.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.error) throw r.error;
  if (r.status !== 0 || !r.stdout) throw new Error('DPAPI ' + op + ' 失敗：' + String(r.stderr || '').trim().slice(0, 200));
  return Buffer.from(r.stdout.trim(), 'base64');
}
const dpapiProtector = () => ({ name: 'dpapi', protect: b => dpapi('Protect', b), unprotect: b => dpapi('Unprotect', b) });

// 讀取或建立資料金鑰；protector 失敗就丟出錯誤，由呼叫端改用明文模式並提示使用者
function loadOrCreateKey(keyFile, protector) {
  if (fs.existsSync(keyFile)) {
    const key = protector.unprotect(fs.readFileSync(keyFile));
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('資料金鑰格式不正確（可能不是同一個 Windows 帳戶）');
    return key;
  }
  const key = crypto.randomBytes(32), wrapped = protector.protect(key);
  if (!protector.unprotect(wrapped).equals(key)) throw new Error('資料金鑰驗證失敗');
  fs.writeFileSync(keyFile, wrapped);
  return key;
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.from(ENC_MAGIC + JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }));
}
function open(key, buf) {
  const s = buf.toString('utf8');
  if (!s.startsWith(ENC_MAGIC)) throw new Error('不是加密資料檔');
  const o = JSON.parse(s.slice(ENC_MAGIC.length));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]);
}
const isSealed = buf => buf.slice(0, ENC_MAGIC.length).toString() === ENC_MAGIC;

// 跨電腦移轉用：以使用者自訂密碼加密（scrypt + AES-256-GCM），不依賴這台電腦的 Windows 帳戶
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function exportSeal(password, plain) {
  const salt = crypto.randomBytes(16), key = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  const inner = seal(key, plain).toString('utf8').slice(ENC_MAGIC.length);
  return Buffer.from(EXP_MAGIC + JSON.stringify({ kdf: 'scrypt', salt: salt.toString('base64'), ...SCRYPT, maxmem: undefined, box: JSON.parse(inner) }));
}
function exportOpen(password, buf) {
  const s = buf.toString('utf8');
  if (!s.startsWith(EXP_MAGIC)) throw new Error('不是有密碼保護的匯出檔');
  const o = JSON.parse(s.slice(EXP_MAGIC.length));
  const key = crypto.scryptSync(String(password), Buffer.from(o.salt, 'base64'), 32, { N: o.N, r: o.r, p: o.p, maxmem: SCRYPT.maxmem });
  try { return open(key, Buffer.from(ENC_MAGIC + JSON.stringify(o.box))); } catch { throw new Error('密碼錯誤或檔案已損壞'); }
}
const isExport = buf => buf.slice(0, EXP_MAGIC.length).toString() === EXP_MAGIC;

module.exports = { dpapiProtector, loadOrCreateKey, seal, open, isSealed, exportSeal, exportOpen, isExport };

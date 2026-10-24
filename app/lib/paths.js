// 檔案位置：程式資料夾（appDir）與使用者資料（dataDir）分開，資料預設放在 %LOCALAPPDATA%\AI-Roundtable，不跟程式一起被 OneDrive 同步或被更新覆蓋
const path = require('path'), os = require('os');

function resolvePaths({ appDir, dataDir } = {}) {
  const base = dataDir || process.env.RT_DATA_DIR
    || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'AI-Roundtable');
  return {
    appDir, dataDir: base,
    encFile: path.join(base, 'data.enc'),          // 加密後的對話與設定
    plainFile: path.join(base, 'data.json'),       // 加密關閉或失敗時才使用
    keyFile: path.join(base, 'key.dpapi'),         // 用 Windows 帳戶（DPAPI）保護的資料金鑰
    backupDir: path.join(base, 'backups'),
    workRoot: path.join(base, 'workspaces'),       // 每個專案／對話一個工作資料夾
    lockFile: path.join(base, 'instance.lock'),
    legacyData: appDir ? path.join(appDir, 'data.json') : null,   // v1.0 放在程式資料夾的明文資料
    legacyWork: appDir ? path.join(appDir, 'sandbox') : null,
  };
}

module.exports = { resolvePaths };

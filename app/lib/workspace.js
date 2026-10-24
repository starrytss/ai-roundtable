// 每個專案／對話有自己的工作資料夾；所有由使用者或 AI 給的路徑都要確認真的落在資料夾裡（含符號連結與 junction）
const fs = require('fs'), path = require('path');

const ID = /^[a-z0-9]{6,40}$/i;
function workdirFor(root, pid, cid) {
  if (!ID.test(pid) || !ID.test(cid)) throw new Error('工作資料夾代號不正確');
  const dir = path.join(root, pid, cid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const within = (base, p) => { const r = path.relative(base, p); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };

// rel 必須是相對路徑；解析後（包含連結指向的真實位置）仍在 base 內才回傳
function resolveInside(base, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes('\0')) throw new Error('路徑不在允許的資料夾內');
  const realBase = fs.realpathSync(base), target = path.resolve(realBase, rel);
  if (!within(realBase, target)) throw new Error('路徑不在允許的資料夾內');
  let probe = target;   // 從最近存在的上層開始檢查真實路徑，擋掉中途的連結
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  if (!within(realBase, fs.realpathSync(probe))) throw new Error('路徑透過連結指向資料夾外');
  return target;
}

// 列出工作資料夾裡的檔案（給成果面板）；連結一律略過不跟隨
function listFiles(base, { max = 500 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) return;
      const full = path.join(dir, e.name), st = fs.lstatSync(full);
      if (st.isSymbolicLink()) { out.push({ path: path.relative(base, full), link: true }); continue; }
      if (st.isDirectory()) { if (depth < 6) walk(full, depth + 1); continue; }
      out.push({ path: path.relative(base, full), size: st.size, mtime: st.mtimeMs });
    }
  };
  walk(base, 0);
  return out;
}

module.exports = { workdirFor, resolveInside, listFiles, within };

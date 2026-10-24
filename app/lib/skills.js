// 掃描各 AI 已安裝的技能（讀取 SKILL.md 的 name / description）
const fs = require('fs'), path = require('path'), os = require('os');

function skillDirs(home = os.homedir()) {
  return {
    chatgpt: [path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'skills'), path.join(home, '.agents', 'skills')],
    claude: [path.join(home, '.claude', 'skills')],
    gemini: [path.join(home, '.gemini', 'skills'), path.join(home, '.gemini', 'antigravity', 'skills'), path.join(home, '.gemini', 'antigravity-cli', 'skills')],
  };
}
let cache = null, cacheAt = 0;
function scanSkills({ refresh = false, dirs = skillDirs() } = {}) {
  if (!refresh && cache && Date.now() - cacheAt < 30000) return cache;
  const out = [], seen = new Set();
  const walk = (ai, dir, depth) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const md = list.find(f => f.isFile() && f.name.toLowerCase() === 'skill.md');
    if (md) {
      let txt = ''; try { txt = fs.readFileSync(path.join(dir, md.name), 'utf8'); } catch {}
      const fm = (txt.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || '';
      const get = k => ((fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').replace(/^["'>|]\s*|["']$/g, '').trim();
      const name = get('name') || path.basename(dir), key = ai + ':' + name;
      if (!seen.has(key)) { seen.add(key); out.push({ ai, name, desc: get('description').slice(0, 160), system: dir.includes('.system'), file: path.join(dir, md.name) }); }
      return;
    }
    if (depth > 0) for (const f of list) if (f.isDirectory() && f.name !== 'node_modules') walk(ai, path.join(dir, f.name), depth - 1);
  };
  for (const ai in dirs) for (const d of dirs[ai]) walk(ai, d, 3);
  out.sort((a, b) => a.system - b.system || a.name.localeCompare(b.name));
  cache = out; cacheAt = Date.now(); return out;
}
const skillNames = q => [...new Set([...String(q).matchAll(/\$([A-Za-z0-9][\w.-]*)/g)].map(m => m[1].replace(/[.]+$/, '')))];
// 問題裡用 $名稱 指定、但這個 AI 沒安裝的技能 → 需要轉述的技能
function relayFor(q, aiId, skills) {
  const res = [];
  for (const n of skillNames(q)) {
    const owners = skills.filter(x => x.name.toLowerCase() === n.toLowerCase());
    if (owners.length && !owners.some(x => x.ai === aiId)) res.push(owners[0]);
  }
  return res;
}
function skillBody(sk) {
  try { return fs.readFileSync(sk.file, 'utf8').replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim(); } catch { return ''; }
}

module.exports = { scanSkills, relayFor, skillBody, skillNames, skillDirs };

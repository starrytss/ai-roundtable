// 討論分支：從某一場討論的某一輪建立新對話（方案 A／B）。共同背景完整複製，之後兩邊各自發展、互不影響
const fs = require('fs'), path = require('path');
const { computeStatus } = require('./status');

const clone = o => JSON.parse(JSON.stringify(o));
function branchChat({ project, chat, turnId, round, title, uid }) {
  const idx = chat.turns.findIndex(t => t.id === turnId);
  if (idx < 0) throw new Error('找不到這場討論');
  const src = chat.turns[idx], kind = src.mode === 'relay' ? 'stage' : 'answer';
  const max = Math.max(0, ...src.steps.filter(s => s.kind === kind && s.status === 'ok' && !s.superseded).map(s => s.round));
  const r = Math.max(1, Math.min(max, round | 0 || max));
  if (!max) throw new Error('這場討論還沒有成功的回答，無法建立分支');
  const base = clone(src);
  base.id = uid();
  base.steps = base.steps.filter(s => s.kind === kind && s.round <= r && s.status === 'ok' && !s.superseded).map(s => ({ ...s, id: uid() }));
  if (base.mode === 'relay') base.stages = (base.stages || []).slice(0, r);
  Object.assign(base, { rounds: r, summary: '', analysis: undefined, waitingAfter: null, stopped: false, branchBase: { round: r } });
  Object.assign(base, computeStatus(base));
  const c = { id: uid(), title: String(title || `${chat.title}（分支）`).slice(0, 60), updated: Date.now(),
    turns: [...chat.turns.slice(0, idx).map(clone), base], outputs: clone(chat.outputs || []), decisions: clone(chat.decisions || []), ...(chat.team ? { team: clone(chat.team) } : {}),
    branchOf: { cid: chat.id, title: chat.title, turnId, round: r, unit: src.mode === 'relay' ? '棒' : '輪', at: Date.now() } };
  project.chats.push(c);
  return c;
}
// 複製工作資料夾當作共同背景（略過連結，不跟隨到資料夾外）
function copyWorkspace(from, to) {
  if (!fs.existsSync(from)) return 0;
  let n = 0;
  const walk = (a, b) => {
    for (const e of fs.readdirSync(a, { withFileTypes: true })) {
      const s = path.join(a, e.name), d = path.join(b, e.name), st = fs.lstatSync(s);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { fs.mkdirSync(d, { recursive: true }); walk(s, d); }
      else if (st.isFile()) { fs.copyFileSync(s, d); n++; }
    }
  };
  fs.mkdirSync(to, { recursive: true }); walk(from, to);
  return n;
}

module.exports = { branchChat, copyWorkspace };

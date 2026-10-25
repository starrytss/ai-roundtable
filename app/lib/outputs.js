// 成果範本與成果檔案：本程式自己產生的檔案只有 Markdown、HTML（可列印成 PDF）、CSV（Excel 可開啟）；
// Word／PowerPoint 需要有寫入權限的 AI 自己產生，面板只列出實際存在的檔案，不會假裝下載成功
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { md } = require('./mdhtml');
const { resolveInside, listFiles } = require('./workspace');

const OUTPUT_TEMPLATES = {
  campaign: { name: '行銷活動提案', spec: '用 Markdown 輸出：# 活動名稱、## 目標與對象、## 核心概念、## 活動流程（表格：階段｜時間｜內容｜負責）、## 預算（表格：項目｜金額｜說明）、## 成效指標、## 風險與備案。' },
  schedule: { name: '工作分工與時程', spec: '用 Markdown 輸出：# 專案名稱、## 里程碑、## 分工時程（表格：工作項目｜負責人｜開始｜完成｜依賴）、## 風險與緩衝。' },
  budget: { name: '預算比較', spec: '用 Markdown 輸出：# 比較主題、## 比較表（表格：方案｜費用｜包含項目｜限制｜優點｜缺點）、## 建議與理由、## 需要再確認的報價。' },
  decision: { name: '決策紀錄', spec: '用 Markdown 輸出：# 決策主題、## 背景、## 考慮過的方案（表格：方案｜優點｜缺點）、## 決定與理由、## 未採用的建議與原因、## 後續追蹤。' },
  webspec: { name: '網站開發需求', spec: '用 Markdown 輸出：# 網站名稱、## 目標與使用者、## 頁面架構、## 功能需求（表格：功能｜說明｜優先順序）、## 非功能需求、## 技術選擇、## 驗收條件。' },
  qa: { name: '測試與驗收清單', spec: '用 Markdown 輸出：# 驗收範圍、## 測試清單（表格：編號｜項目｜步驟｜預期結果｜結果）、## 未通過時的處理、## 簽核。' },
};
const FORMATS = { md: '.md', html: '.html', csv: '.csv' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const slug = s => String(s || '成果').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60) || '成果';

// 第一個 Markdown 表格 → CSV（UTF-8 BOM，Excel 才會正確顯示中文）
function toCsv(text) {
  const lines = String(text).split(/\r?\n/), start = lines.findIndex((l, i) => l.trim().startsWith('|') && /^\|?\s*:?-{2,}/.test((lines[i + 1] || '').trim()));
  if (start < 0) return null;
  const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\*\*/g, ''));
  const rows = [row(lines[start])];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(row(lines[i]));
  const cell = c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
function toHtml(text, title) {
  const t = String(title).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${t}</title>
<style>body{font:15px/1.75 "Microsoft JhengHei",system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#201d18}table{border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:5px 10px;text-align:left}th{background:#f2eee6}code{background:#f2eee6;padding:1px 4px;border-radius:4px}footer{margin-top:40px;font-size:12px;color:#888}@media print{body{margin:0}}</style>
<body>${md(text)}<footer>由 AI圓桌會議 產生 · 可用瀏覽器「列印 → 另存為 PDF」</footer></body></html>`;
}

// 存一個新版本：同名成果自動加上 -v2、-v3，不覆蓋舊版
function saveOutput({ workdir, chat, name, format = 'md', text, from = {}, template = '' }) {
  if (!FORMATS[format]) throw new Error('不支援的格式');
  const content = format === 'html' ? toHtml(text, name) : format === 'csv' ? toCsv(text) : String(text);
  if (content == null) throw new Error('內容裡沒有表格，無法轉成 CSV');
  const base = slug(name);
  chat.outputs = chat.outputs || [];
  const version = 1 + Math.max(0, ...chat.outputs.filter(o => o.base === base && o.format === format).map(o => o.version));   // 每種格式各自編號
  const rel = path.join('outputs', `${base}-v${version}${FORMATS[format]}`);
  fs.mkdirSync(path.join(workdir, 'outputs'), { recursive: true });
  const file = resolveInside(workdir, rel);
  fs.writeFileSync(file, content);
  const rec = { id: crypto.randomBytes(6).toString('hex'), base, name: String(name).slice(0, 80), version, path: rel.split(path.sep).join('/'), format, template,
    from: { turnId: from.turnId || '', stepId: from.stepId || '', ai: from.ai || '', kind: from.kind || '' }, text: String(text), at: Date.now(), sha256: sha(content), bytes: Buffer.byteLength(content) };
  chat.outputs.push(rec);
  return rec;
}

// 檔案面板：工作資料夾裡實際存在的檔案，加上來源（本程式產生的成果，或 AI 工具紀錄裡寫入的路徑）
function fileIndex(workdir, chat) {
  const outs = new Map((chat.outputs || []).map(o => [o.path, o]));
  const writers = new Map();
  for (const t of chat.turns || []) for (const s of t.steps || []) for (const e of s.events || []) {
    if (e.kind !== 'write' || !e.path) continue;
    let rel; try { rel = path.relative(fs.realpathSync(workdir), path.resolve(workdir, e.path)).split(path.sep).join('/'); } catch { continue; }
    if (!rel.startsWith('..')) writers.set(rel, { turnId: t.id, stepId: s.id, ai: s.ai });
  }
  return listFiles(workdir).map(f => {
    const p = f.path.split(path.sep).join('/'), o = outs.get(p);
    return { ...f, path: p, output: o ? { id: o.id, name: o.name, version: o.version, template: o.template, from: o.from, sha256: o.sha256 } : null, writtenBy: writers.get(p) || null };
  });
}
const TEXT = /\.(md|txt|csv|json|html?|css|js|ts|py|xml|ya?ml|log)$/i;
function readFile(workdir, rel, max = 200000) {
  const file = resolveInside(workdir, rel), st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('只能讀取一般檔案');
  if (!TEXT.test(file)) return { path: rel, bytes: st.size, binary: true };
  const buf = fs.readFileSync(file);
  return { path: rel, bytes: st.size, text: buf.slice(0, max).toString('utf8').replace(/^﻿/, ''), truncated: st.size > max };
}

module.exports = { OUTPUT_TEMPLATES, FORMATS, saveOutput, fileIndex, readFile, toCsv, toHtml, slug };

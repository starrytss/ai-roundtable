// 介面語言：中文是原文，英文用對照表即時翻譯畫面上的文字
// 只翻介面；AI 的回答、你的提問、程式碼區塊都不翻（SKIP）。整段都找得到對照才換，避免把你自己的內容翻得半中半英
import EN from './i18n-en.js';

const CJK = /[㐀-鿿]/;
const SKIP = '.md, .bubble, pre, code, textarea, script, style, [data-notr]';
const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
const PUNCT = { '，': ', ', '。': '. ', '：': ': ', '；': '; ', '、': ', ', '（': ' (', '）': ') ', '「': '"', '」': '"', '？': '? ', '！': '! ', '　': ' ', '～': '–' };
let on = false, exact = new Map(), pats = [], phraseRe = null;

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function build() {
  for (const [k, v] of Object.entries(EN)) {
    if (k.includes('{}')) pats.push([new RegExp('^' + k.split('{}').map(reEsc).join('(.+?)') + '$', 's'), v, k.length]);
    else exact.set(k, v);
  }
  pats.sort((a, b) => b[2] - a[2]);   // 字比較多的樣式先比對
  const keys = [...exact.keys()].filter(k => CJK.test(k)).sort((a, b) => b.length - a.length);
  phraseRe = new RegExp(keys.map(reEsc).join('|'), 'g');
}
const fill = (v, groups) => { let i = 0; return v.replace(/\{(\d*)\}/g, (_, n) => groups[n === '' ? i++ : +n] ?? ''); };

export const isEnglish = () => on;
export function tr(s) {
  if (!on || !s || !CJK.test(s)) return s;
  const m = String(s).match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
  let out = exact.get(core), guess = null;
  // 樣式：插入的值可能是使用者自己的中文（名稱、職務），所以留有中文也先記下來
  if (out == null) for (const [re, v] of pats) { const g = core.match(re); if (g) { const r = fill(v, g.slice(1).map(tr)); if (CJK.test(r)) { guess = r; break; } out = r; break; } }
  // 用全形空白或「·」並排的幾段（例如各 AI 的用量）分開翻
  // 每一段各自整段對照，使用者自己的中文（職務、名稱）那段保持原文
  if (out == null && /　| · /.test(m[2])) { const p = m[2].split(/(　| · )/).map(x => /　| · /.test(x) ? x : tr(x)).join(''); if (p !== m[2]) out = p; }
  if (out == null) {   // 由幾個已知片段與標點組成時才換；還留有中文就保持原文
    const p = core.replace(phraseRe, k => ' ' + exact.get(k) + ' ').replace(/[，。：；、（）「」？！　～]/g, c => PUNCT[c])
      .replace(/\s+/g, ' ').replace(/\s([,.;:)!?])/g, '$1').replace(/\(\s/g, '(').trim();
    if (!CJK.test(p)) out = p;
  }
  out = out ?? guess;
  return out == null ? s : m[1] + out.replace(/、/g, ', ') + m[3];   // 名稱清單的頓號改成英文逗號
}

function fixText(n) {
  if (!CJK.test(n.nodeValue) || (n.parentElement && n.parentElement.closest(SKIP))) return;
  const t = tr(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t;
}
function fixAttrs(el) {
  for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && CJK.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
}
function walk(root) {
  if (root.nodeType === 3) return fixText(root);
  if (root.nodeType !== 1) return;
  if (root.closest(SKIP)) { if (root.matches('textarea, input')) fixAttrs(root); return; }
  fixAttrs(root);
  // 輸入框裡是使用者的文字，但它的提示文字（placeholder、title）屬於介面，照樣翻
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => {
    if (n.nodeType !== 1 || !n.matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
    if (n.matches('textarea, input')) fixAttrs(n);
    return NodeFilter.FILTER_REJECT;
  } });
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? fixText(n) : fixAttrs(n);
}

// lang：'en' 或 'zh-TW'；英文時翻譯整個畫面，之後新增或改變的內容也跟著翻
export function useLanguage(lang) { on = lang === 'en'; if (on && !phraseRe) build(); return on; }
export function startI18n(lang) {
  document.documentElement.lang = useLanguage(lang) ? 'en' : 'zh-Hant-TW';
  if (!on) return;
  // 日期時間也用英文格式（沒有指定語系的呼叫才改）
  for (const f of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) { const o = Date.prototype[f]; Date.prototype[f] = function (loc, opt) { return o.call(this, loc || 'en-US', opt); }; }
  walk(document.body); document.title = tr(document.title);
  new MutationObserver(ms => { for (const m of ms) {
    if (m.type === 'childList') m.addedNodes.forEach(walk);
    else if (m.type === 'characterData') fixText(m.target);
    else fixAttrs(m.target);
  } }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const c = window.confirm.bind(window), p = window.prompt.bind(window), a = window.alert.bind(window);
  window.confirm = s => c(tr(s)); window.prompt = (s, d) => p(tr(s), d); window.alert = s => a(tr(s));
}

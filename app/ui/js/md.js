// 簡易 Markdown（全部先跳脫再轉換，AI 回答裡的 HTML 不會被執行；連結只允許 http/https）
import { esc } from './core.js';
export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
export function md(src) {
  const out = [], parts = String(src || '').split(/```[^\n]*\n?/);
  parts.forEach((part, k) => {
    if (k % 2) { out.push(`<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`); return; }
    const L = part.split('\n'); let i = 0, para = [];
    const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    while (i < L.length) {
      const l = L[i], t = l.trim();
      if (!t) { flush(); i++; continue; }
      let m;
      if (t.startsWith('|') && /^\|?\s*:?-{2,}/.test((L[i + 1] || '').trim())) {
        flush(); const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
        let h = `<table><tr>${row(l).map(c => `<th>${c}</th>`).join('')}</tr>`; i += 2;
        while (i < L.length && L[i].trim().startsWith('|')) h += `<tr>${row(L[i++]).map(c => `<td>${c}</td>`).join('')}</tr>`;
        out.push(h + '</table>'); continue;
      }
      if ((m = t.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); out.push('<hr>'); i++; continue; }
      if (t.startsWith('>')) { flush(); const q = []; while (i < L.length && L[i].trim().startsWith('>')) q.push(L[i++].trim().replace(/^>\s?/, '')); out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`); continue; }
      const ul = /^\s*[-*+•]\s+/, ol = /^\s*\d+[.)、]\s+/;
      if (ul.test(l) || ol.test(l)) {
        flush(); const isOl = ol.test(l), re = isOl ? ol : ul, items = [];
        while (i < L.length && re.test(L[i])) {
          let it = L[i++].replace(re, '');
          while (i < L.length && L[i].trim() && !ul.test(L[i]) && !ol.test(L[i]) && /^\s{2,}/.test(L[i])) it += '<br>' + L[i++].trim();
          items.push(it);
        }
        out.push(`<${isOl ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x).replace(/&lt;br&gt;/g, '<br>')}</li>`).join('')}</${isOl ? 'ol' : 'ul'}>`); continue;
      }
      para.push(l); i++;
    }
    flush();
  });
  return out.join('');
}

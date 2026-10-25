// 本機全文搜尋：只在這台電腦的資料裡找，不送到任何遠端服務
// 關鍵字以空白分隔，全部都要出現；可依標籤、AI、日期、收藏篩選
function snippet(text, terms, n = 70) {
  const t = String(text || ''), low = t.toLowerCase();
  const i = Math.max(0, Math.min(...terms.map(x => low.indexOf(x)).filter(x => x >= 0), t.length));
  const start = Math.max(0, i - n), end = Math.min(t.length, i + n);
  return (start ? '…' : '') + t.slice(start, end).replace(/\s+/g, ' ') + (end < t.length ? '…' : '');
}

function search(db, { q = '', tag = '', ai = '', from = 0, to = 0, fav = false, pid = '' } = {}, limit = 200) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const hit = text => terms.every(x => String(text || '').toLowerCase().includes(x));
  const out = [];
  for (const p of db.projects) {
    if (pid && p.id !== pid) continue;
    for (const c of p.chats) {
      if (tag && !(c.tags || []).includes(tag)) continue;
      for (const t of c.turns || []) {
        const at = t.at || 0;
        if ((from && at < from) || (to && at > to)) continue;
        const base = { pid: p.id, project: p.name, cid: c.id, chat: c.title, tags: c.tags || [], turnId: t.id, at };
        if (!fav && !ai && terms.length && hit(t.q)) out.push({ ...base, kind: 'question', snippet: snippet(t.q, terms) });
        for (const s of t.steps || []) {
          if (s.status !== 'ok' || s.superseded || !s.text) continue;
          if (ai && s.ai !== ai) continue;
          if (fav && !s.favorite) continue;
          if (terms.length && !hit(s.text)) continue;
          if (!terms.length && !fav && !ai && !tag) continue;
          out.push({ ...base, kind: s.kind, stepId: s.id, ai: s.ai, round: s.round, favorite: !!s.favorite, snippet: terms.length ? snippet(s.text, terms) : String(s.text).slice(0, 140) });
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

module.exports = { search, snippet };

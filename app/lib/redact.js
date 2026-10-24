// 敏感資訊偵測與遮蔽（可選）：在送出前把找到的值換成固定代號，同一個值在整場討論用同一個代號
// 偵測是規則比對，不保證找到全部；介面會顯示找到什麼、遮蔽後的實際內容

const twIdOk = s => {
  const L = 'ABCDEFGHJKLMNPQRSTUVXYWZIO', n = L.indexOf(s[0]) + 10;
  if (n < 10) return false;
  const d = [Math.floor(n / 10), n % 10, ...s.slice(1).split('').map(Number)];
  const w = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  return d.reduce((a, x, i) => a + x * w[i], 0) % 10 === 0;
};
const luhn = s => { const d = s.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false; let sum = 0; for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; } return sum % 10 === 0; };

const DETECTORS = [
  { type: 'private_key', label: '私密金鑰', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'api_key', label: 'API 金鑰', re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})/g },
  { type: 'token', label: '存取權杖', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'password', label: '密碼', re: /(?:password|passwd|pwd|密碼)\s*[:=：]\s*(\S{4,})/gi, group: 1 },
  { type: 'email', label: 'Email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'tw_id', label: '身分證字號', re: /\b[A-Z][12]\d{8}\b/g, ok: twIdOk },
  { type: 'card', label: '信用卡號', re: /\b\d(?:[ -]?\d){12,18}\b/g, ok: luhn },
  { type: 'phone', label: '手機號碼', re: /(?<!\d)(?:\+886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)/g },
];

function detect(text) {
  const found = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    for (const m of String(text).matchAll(d.re)) {
      const value = d.group ? m[d.group] : m[0], start = m.index + (d.group ? m[0].indexOf(value) : 0);
      if (d.ok && !d.ok(value)) continue;
      if (found.some(f => start < f.end && start + value.length > f.start)) continue;   // 已被較優先的規則涵蓋
      found.push({ type: d.type, label: d.label, start, end: start + value.length, value });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// table：值 → 代號，同一場討論共用，讓 AI 之間提到同一個人或號碼時仍對得起來
function mask(text, table = new Map()) {
  const f = detect(text); let out = '', last = 0;
  for (const x of f) {
    if (!table.has(x.value)) table.set(x.value, `〔已遮蔽：${x.label} ${[...table.values()].filter(v => v.includes(x.label)).length + 1}〕`);
    out += text.slice(last, x.start) + table.get(x.value); last = x.end;
  }
  return { text: out + String(text).slice(last), findings: f.map(({ type, label, value }) => ({ type, label, placeholder: table.get(value), preview: value.length > 8 ? value.slice(0, 3) + '…' + value.slice(-2) : '…' })) };
}

module.exports = { detect, mask, twIdOk, luhn };

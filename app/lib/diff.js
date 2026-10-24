// 逐行比較兩個版本：回傳新增、刪除、相同的行，以及統計；太大的文件改用段落比較，避免卡住
function lcsDiff(a, b) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'eq', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: a[i++] });
    else out.push({ type: 'add', text: b[j++] });
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}
function diff(before, after) {
  let a = String(before ?? '').split(/\r?\n/), b = String(after ?? '').split(/\r?\n/), unit = 'line';
  if (a.length * b.length > 4e6) { a = String(before).split(/\n\s*\n/); b = String(after).split(/\n\s*\n/); unit = 'paragraph'; }
  const ops = lcsDiff(a, b);
  return { unit, ops, added: ops.filter(o => o.type === 'add').length, removed: ops.filter(o => o.type === 'del').length, same: ops.filter(o => o.type === 'eq').length };
}

module.exports = { diff };

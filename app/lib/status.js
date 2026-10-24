// 一場討論的結果狀態：完整完成 / 部分完成 / 全部失敗 / 使用者中止 / 程式中斷 / 等待使用者介入
// reasons 是結構化的原因，介面再轉成文字；不會因為「流程跑完」就算完成。使用者自己略過的步驟不算失敗

const live = t => (t.steps || []).filter(s => !s.superseded);
const counted = t => live(t).filter(s => !s.userSkipped && s.kind !== 'analysis');
// 最後一輪 = 使用者沒有略過的回答中，輪次最大的一輪
const lastRound = t => Math.max(0, ...counted(t).filter(s => s.kind === 'answer').map(s => s.round));

function computeStatus(t) {
  const steps = counted(t), reasons = [];
  if (live(t).some(s => s.status === 'running')) return { status: 'running', reasons };
  if (t.stopped) return { status: 'stopped', reasons: [{ code: 'stopped' }] };
  if (steps.some(s => s.status === 'interrupted')) return { status: 'interrupted', reasons: [{ code: 'interrupted' }] };
  const answers = steps.filter(s => s.kind === 'answer');
  if (steps.some(s => s.status === 'pending')) return { status: 'waiting', reasons: [{ code: t.waitingAfter ? 'paused' : 'pending', round: t.waitingAfter }] };
  if (!answers.some(s => s.status === 'ok')) return { status: 'failed', reasons: [{ code: 'all_failed' }] };
  for (const s of answers) {
    if (s.status === 'error') reasons.push({ code: 'answer_failed', ai: s.ai, round: s.round, text: s.error?.text || '' });
    if (s.status === 'skipped') reasons.push({ code: 'answer_skipped', ai: s.ai, round: s.round });
  }
  const last = lastRound(t);
  if (!answers.some(s => s.round === last && s.status === 'ok')) reasons.push({ code: 'last_round_empty', round: last });
  if (t.ids.length > 1) {
    const sum = steps.filter(s => s.kind === 'summary').pop();
    if (!sum) reasons.push({ code: 'no_summary' });
    else if (sum.status !== 'ok') reasons.push({ code: 'summary_failed', ai: sum.ai, text: sum.error?.text || '' });
  }
  return { status: reasons.length ? 'partial' : 'done', reasons };
}

module.exports = { computeStatus, live, lastRound };

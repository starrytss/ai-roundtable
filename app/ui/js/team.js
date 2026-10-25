// 這個對話的分工：每位 AI 這次往哪個方向研究，主持人負責整合；可存成研究團隊範本
import { $, S, api, esc, ai, av, toast, savePref } from './core.js';
import { renderComposer } from './composer.js';

const short = (s, n = 18) => (s.length > n ? s.slice(0, n) + '…' : s);
export const teamRoles = () => (S.chat && S.chat.team && S.chat.team.roles) || null;

// 輸入框上方的分工標籤：只列出這次有勾選的 AI
export function teamChip() {
  const roles = teamRoles(); if (!roles || $('#mode').value === 'relay') return '';
  const ids = S.pref.ids || [], on = ids.filter(id => roles[id]), off = ids.filter(id => !roles[id]);
  const mod = ids.length > 1 ? `　·　主持人整合：${esc(ai($('#mod').value).name)}` : '';
  return `<span class="skchip"><b>👥 這個對話的分工</b><small>${on.map(id => `${esc(ai(id).name)}：${esc(short(roles[id]))}`).join('　') || '勾選的 AI 都沒有指定職務'}${off.length ? `　·　未指定：${off.map(id => esc(ai(id).name)).join('、')}` : ''}${mod}</small><button data-editteam title="編輯">✎</button><button data-rmteam title="清除分工">✕</button></span>`;
}

let draft = null;
export function openTeam() {
  const roles = teamRoles() || {};
  draft = { ids: [...(S.pref.ids || [])], roles: { ...roles }, mod: S.pref.mod };
  renderTeam();
  if (!$('#dlgTeam').open) $('#dlgTeam').showModal();
}
function renderTeam() {
  const tpls = S.D.settings.teamTemplates || [], keys = Object.keys(S.D.settings.ais);
  const inside = keys.filter(k => draft.ids.includes(k));
  if (!inside.includes(draft.mod)) draft.mod = inside[0];
  $('#teamBody').innerHTML = `<div class="small">為這個對話的每位 AI 指定職務，大家同時往不同方向研究，最後由主持人整合成一份結論。分工只套用在這個對話，會取代 AI 設定裡的角色；換題目時再回來改就好。同一家 AI 想用兩種職務，可以先在 AI 設定新增席位。</div>
    <div class="row2"><select class="field" id="teamTpl"><option value="">套用研究團隊範本…</option>${tpls.map(t => `<option>${esc(t.name)}</option>`).join('')}</select><button class="btn" id="teamDel">刪除範本</button></div>
    ${keys.map(k => { const a = ai(k), on = draft.ids.includes(k); return `<div class="team-row ${on ? '' : 'off'}" data-k="${k}">
      <label class="sk">${av(k)}<input type="checkbox" data-on ${on ? 'checked' : ''}> <b>${esc(a.name)}</b></label>
      <input class="field" data-role value="${esc(draft.roles[k] || '')}" placeholder="${a.role ? '沒填就用 AI 設定的角色：' + esc(short(a.role, 24)) : '這次的職務，例如：市場規模與競品'}" ${on ? '' : 'disabled'}></div>`; }).join('')}
    <div class="row2"><span>主持人（負責整合）</span><select class="field" id="teamMod">${inside.map(k => `<option value="${k}" ${k === draft.mod ? 'selected' : ''}>${esc(ai(k).name)}</option>`).join('')}</select></div>
    <div class="small">主持人也可以同時負責一個方向。整合時它會先分別整理每個方向的重點，再說明互相支持或衝突的地方，最後給出建議。</div>`;
}
function readTeam() {
  document.querySelectorAll('#teamBody .team-row').forEach(row => {
    const k = row.dataset.k, on = row.querySelector('[data-on]').checked, v = row.querySelector('[data-role]').value.trim();
    draft.ids = on ? [...new Set([...draft.ids, k])] : draft.ids.filter(x => x !== k);
    if (v) draft.roles[k] = v; else delete draft.roles[k];
  });
  const m = $('#teamMod'); if (m && m.value) draft.mod = m.value;
  draft.ids = Object.keys(S.D.settings.ais).filter(k => draft.ids.includes(k));   // 保持設定裡的順序
}
const chosenRoles = () => Object.fromEntries(draft.ids.filter(k => draft.roles[k]).map(k => [k, draft.roles[k]]));

export function bindTeam(after = () => {}) {
  $('#teamBody').onchange = e => {
    if (e.target.id === 'teamTpl') {
      const t = (S.D.settings.teamTemplates || []).find(x => x.name === e.target.value); if (!t) return;
      const ks = Object.keys(t.roles).filter(k => S.D.settings.ais[k]);
      draft = { ids: ks, roles: Object.fromEntries(ks.map(k => [k, t.roles[k]])), mod: ks.includes(t.mod) ? t.mod : ks[0] };
      return renderTeam();
    }
    if (e.target.matches('[data-on]')) { readTeam(); renderTeam(); }
  };
  $('#teamBody').onclick = async e => {
    if (e.target.id !== 'teamDel') return;
    const n = $('#teamTpl').value; if (!n || !confirm(`刪除範本「${n}」？`)) return;
    const r = await api('/api/teams/delete', { name: n }); S.D.settings.teamTemplates = r.teamTemplates; readTeam(); renderTeam();
  };
  $('#teamSave').onclick = async () => {
    readTeam(); const n = prompt('研究團隊範本名稱', $('#teamTpl').value || ''); if (!n) return;
    const r = await api('/api/teams/save', { name: n, roles: chosenRoles(), mod: draft.mod }); if (r.error) return toast(r.error);
    S.D.settings.teamTemplates = r.teamTemplates; toast('已儲存研究團隊範本'); renderTeam();
  };
  $('#teamUse').onclick = async () => {
    readTeam();
    if (draft.ids.length < 2) return toast('分工至少需要勾選兩位 AI');
    const roles = chosenRoles(); if (!Object.keys(roles).length) return toast('請至少為一位 AI 填寫職務');
    if (!S.cid) { S.cid = (await api('/api/chat/new', { pid: S.pid })).id; localStorage.cid = S.cid; S.chat = { id: S.cid, turns: [] }; }   // 還沒有對話時先建立，分工存在這個新對話
    const r = await api('/api/chat/team', { pid: S.pid, cid: S.cid, roles }); if (r.error) return toast(r.error);
    if (S.chat) S.chat.team = r.team;
    Object.assign(S.pref, { ids: draft.ids, mod: draft.mod, modOutside: false });
    if (S.pref.mode === 'relay') S.pref.mode = 'discuss';
    savePref(); $('#dlgTeam').close(); renderComposer(); after();
  };
}
export async function clearTeam() {
  if (!S.cid) return;
  const r = await api('/api/chat/team', { pid: S.pid, cid: S.cid, roles: {} }); if (r.error) return toast(r.error);
  if (S.chat) S.chat.team = null; renderComposer(); toast('已清除這個對話的分工');
}

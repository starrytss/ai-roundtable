// 把 CLI 的原始錯誤翻成看得懂的說明與下一步；只依錯誤內容判斷，不猜測沒出現的原因
const RULES = [
  ['abort', /^已中止$/, '已中止。', null],
  ['missing', /找不到程式|ENOENT|not recognized|不是內部或外部命令/i, '找不到這個 AI 的程式，可能還沒安裝，或安裝後還沒重新開啟。', 'install'],
  ['incompatible', /unknown option|unexpected argument|unrecognized (argument|option)|invalid value for|flag provided but not defined/i, '這個 CLI 版本不支援本程式需要的參數，請更新 CLI。', 'update'],
  ['login', /not logged in|please log ?in|log in again|sign ?in|authenticat|unauthori[sz]ed|\b401\b|credential|oauth|登入/i, '還沒登入，或登入已過期。', 'login'],
  ['quota', /usage limit|rate.?limit|quota|limit reached|credit balance|\b429\b|too many requests|exceeded|out of credits/i, '這個帳號的用量已達上限或被暫時限制，請稍後再試，或改用其他 AI。', null],
  ['turns', /max turns/i, '這次回答用到的工具步驟超過上限，回答沒有完成。可以單獨重試，或把權限調成「只用文字回答」。', 'retry'],
  ['timeout', /逾時|timed? ?out/i, '等太久沒有回應，可能是網路問題或程式卡住。', 'retry'],
  ['network', /ENOTFOUND|ECONNRESET|ECONNREFUSED|network|getaddrinfo|socket hang up/i, '網路連線失敗，請確認網路後重試。', 'retry'],
];

function classify(err) {
  const raw = String(err?.message ?? err ?? '');
  if (err?.code === 'ABORT') return { kind: 'abort', text: '已中止。', action: null, raw };
  if (err?.code === 'TIMEOUT') return { kind: 'timeout', text: RULES.find(r => r[0] === 'timeout')[2], action: 'retry', raw };
  for (const [kind, re, text, action] of RULES) if (re.test(raw)) return { kind, text, action, raw: raw.slice(0, 400) };
  return { kind: 'other', text: '發生錯誤：' + raw.slice(0, 200), action: 'retry', raw: raw.slice(0, 400) };
}

module.exports = { classify };

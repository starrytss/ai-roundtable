// 各家 CLI 的串接設定：權限等級 → CLI 自己支援並強制的參數；提示一律走標準輸入，不放在命令列參數
// guarantee：enforced = 由 CLI 強制；partial = 部分由 CLI 強制（notes 寫清楚哪裡不行）；none = 無法限制，只能在提示裡要求
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

const LEVELS = ['text', 'web', 'read', 'write', 'exec'];
const LEVEL_LABEL = { text: '只用文字回答', web: '可搜尋與讀網頁', read: '可讀取工作資料夾', write: '可寫入工作資料夾', exec: '可執行指令' };
const atLeast = (level, min) => LEVELS.indexOf(level) >= LEVELS.indexOf(min);

// ---------- 找到實際的執行檔（不經過 cmd.exe）----------
const exeCache = new Map();
function resolveExe(name) {
  const fake = process.env.RT_FAKE_CLI && JSON.parse(process.env.RT_FAKE_CLI)[name];   // 測試用：指向模擬 CLI
  if (fake) return { exe: fake[0], pre: fake.slice(1), path: fake.join(' ') };
  const hit = exeCache.get(name); if (hit && Date.now() - hit.at < 60000) return hit.v;
  let v = null;
  if (/^[\w.-]+$/.test(name)) {
    const r = process.platform === 'win32'
      ? spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
      : spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    const list = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const exe = list.find(p => /\.exe$/i.test(p)) || (process.platform !== 'win32' && list[0]);
    if (exe) v = { exe, pre: [], path: exe };
    else {
      const shim = list.find(p => /\.cmd$/i.test(p));   // npm 安裝的 .cmd：改成直接用 node 執行它指向的 .js
      const js = shim && (fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+\.js)"/) || [])[1];
      if (js) v = { exe: process.execPath, pre: [path.join(path.dirname(shim), js)], path: shim };
    }
  }
  exeCache.set(name, { v, at: Date.now() });
  return v;
}

// Codex 有 --ignore-user-config 時不會讀使用者設定；保留使用者在 config.toml 選的模型
function codexUserModel(home = os.homedir()) {
  try { return (fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'), 'utf8').match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || ''; } catch { return ''; }
}

const CLAUDE_TOOLS = { text: [], web: ['WebSearch', 'WebFetch'], read: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'], write: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'Write', 'Edit'], exec: ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'PowerShell'] };

const PROVIDERS = {
  claude: {
    name: 'Claude Code', exe: 'claude', parser: 'claude', images: false,
    guarantee(level) {
      if (level === 'exec') return { level: 'none', notes: ['Bash／PowerShell 指令沒有沙盒，可以存取整台電腦'] };
      const notes = ['工具清單由 Claude Code 的 --tools 強制，檔案工具限制在工作資料夾（--restricted）', '不載入你的 CLAUDE.md、外掛、hooks 與 MCP（--safe-mode）'];
      if (level !== 'text') notes.push('搜尋與讀網頁會連到外部網站');
      return { level: 'enforced', notes };
    },
    build({ level, model, isolate = true, reduceTraffic = true }) {
      const tools = CLAUDE_TOOLS[level] || [];
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--restricted', '--strict-mcp-config', '--no-session-persistence',
        '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-turns', '12', '--tools', tools.join(','),
        '--settings', JSON.stringify({ permissions: { blockReadsOutsideWorkingDirectories: true } })];
      if (tools.length) args.push('--allowedTools', tools.join(','));
      if (isolate) args.push('--safe-mode');
      if (model) args.push('--model', model);
      return { args, env: reduceTraffic ? { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } : {}, input: p => p };
    },
    setup: { status: ['auth', 'status'], login: 'claude auth login', logout: 'claude auth logout', install: 'irm https://claude.ai/install.ps1 | iex', page: 'https://code.claude.com/docs/en/setup', needs: ['--restricted', '--safe-mode', '--tools', 'stream-json'] },
    records: ['登入資料：%USERPROFILE%\\.claude 與 %USERPROFILE%\\.claude.json', '本程式加上 --no-session-persistence，不會在 %USERPROFILE%\\.claude\\projects 留下對話紀錄'],
  },
  codex: {
    name: 'Codex CLI', exe: 'codex', parser: 'codex', images: true,
    guarantee(level) {
      const notes = [];
      if (atLeast(level, 'write')) notes.push('寫入限制在工作資料夾（Codex workspace-write 沙盒強制），沙盒內指令預設不能連網');
      else notes.push('唯讀沙盒由 Codex 強制：不能寫檔');
      notes.push('Codex 仍可讀取電腦上的檔案並執行唯讀指令，本程式無法完全關閉');
      if (level === 'text') notes.push('「只用文字回答」只能在提示中要求');
      notes.push('不載入你的 config.toml（通知程式、外掛），只沿用你選的模型');
      return { level: 'partial', notes };
    },
    build({ level, workdir, model, isolate = true }) {
      const args = [];
      if (atLeast(level, 'web')) args.push('--search');
      args.push('exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', atLeast(level, 'write') ? 'workspace-write' : 'read-only', '-C', workdir);
      if (isolate) args.push('--ignore-user-config');
      const m = model || (isolate ? codexUserModel() : '');
      if (m) args.push('-m', m);
      args.push('-');
      return { args, env: {}, input: p => p };
    },
    setup: { status: ['login', 'status'], login: 'codex login', logout: 'codex logout', install: 'npm install -g @openai/codex', page: 'https://developers.openai.com/codex/cli', needs: ['--ignore-user-config', '--ephemeral', '--json'] },
    records: ['登入資料：%USERPROFILE%\\.codex\\auth.json', '本程式加上 --ephemeral，不會在 %USERPROFILE%\\.codex\\sessions 留下對話紀錄'],
  },
  gemini: {
    name: 'Antigravity CLI', exe: 'agy', parser: 'agy', images: false,
    guarantee() {
      return { level: 'none', notes: ['實測 agy 1.4.7 在非互動模式下會直接在工作資料夾內外寫檔、不會詢問，本程式無法限制', '它也有執行指令與操作瀏覽器的工具；權限只能在提示中要求', '需要你確認了解這個風險，才會自動呼叫'] };
    },
    build({ model }) {
      const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands', '--sandbox'];
      if (model) args.push('--model', model);
      args.push('--print=');
      return { args, env: {}, input: p => JSON.stringify({ event: 'user', message: { role: 'user', content: p } }) + '\n' };
    },
    setup: { login: 'agy', install: 'irm https://antigravity.google/cli/install.ps1 | iex', page: 'https://antigravity.google/docs/cli/features/', needs: ['--input-format', '--disable-slash-commands'] },
    records: ['Antigravity 會在 %USERPROFILE%\\.gemini\\antigravity-cli 保存自己的對話紀錄（conversations、conversation_summaries.db），本程式無法關閉'],
  },
  grok: {
    name: 'Grok CLI', exe: 'grok', parser: 'text', images: false, argvPrompt: true, untested: true,
    guarantee() { return { level: 'none', notes: ['尚未實測，權限與資料保存方式未驗證', '這個 CLI 只能把提示放在命令列參數，其他程式可能看得到'] }; },
    build() { return { args: ['-p', '{prompt}'], env: {}, input: () => '' }; },
    setup: { login: 'grok', install: 'irm https://x.ai/cli/install.ps1 | iex' },
    records: ['未驗證'],
  },
  custom: {
    name: '自訂指令', parser: 'text', images: false,
    guarantee() { return { level: 'none', notes: ['自訂指令的權限與資料保存方式無法驗證'] }; },
    build({ cmd }) {
      const parts = (String(cmd).match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ''));
      return { exe: parts[0], args: parts.slice(1), env: {}, input: p => (parts.includes('{prompt}') ? '' : p) };
    },
    setup: {}, records: ['未驗證'],
  },
};

// 回傳一次呼叫需要的一切；argv 裡的 {prompt} 只有 grok 與自訂指令會用到
function invocation(ai, { workdir, reduceTraffic = true }) {
  const P = PROVIDERS[ai.provider]; if (!P) throw new Error('不支援的 AI 類型：' + ai.provider);
  const b = P.build({ level: ai.level || 'web', workdir, model: ai.model, isolate: ai.isolate !== false, reduceTraffic, cmd: ai.cmd });
  const name = b.exe || P.exe, r = resolveExe(name);
  if (!r) return { missing: name };
  return { exe: r.exe, args: [...r.pre, ...b.args], env: b.env, input: b.input, parser: P.parser, argvPrompt: !!P.argvPrompt || b.args.includes('{prompt}'), exePath: r.path };
}
const guarantee = ai => (PROVIDERS[ai.provider] || PROVIDERS.custom).guarantee(ai.level || 'web');
const needsAck = ai => ai.mode === 'auto' && guarantee(ai).level === 'none' && !ai.ack;

module.exports = { PROVIDERS, LEVELS, LEVEL_LABEL, resolveExe, invocation, guarantee, needsAck, codexUserModel, atLeast };

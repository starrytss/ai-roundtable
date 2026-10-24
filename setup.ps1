# AI圓桌會議 安裝程式（山姆蛋實驗室 SamEgg Lab）
$ErrorActionPreference = 'Continue'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $env:LOCALAPPDATA 'Roundtable'
$data = Join-Path $env:LOCALAPPDATA 'AI-Roundtable'

function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Ask($q) { do { $a = Read-Host "$q  (Y/N)" } until ($a -match '^[YyNn]'); return $a -match '^[Yy]' }
function Add-UserPath($p) {
  $u = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $u) { $u = '' }
  if (-not ($u -split ';' | Where-Object { $_ -eq $p })) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $p), 'User') }
  if (-not ($env:Path -split ';' | Where-Object { $_ -eq $p })) { $env:Path += ";$p" }
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
# 遠端安裝腳本：先顯示來源網址，確認後才下載執行；本程式無法驗證腳本內容或雜湊，請確認是官方網址
function Run-Installer($name, $url) {
  Write-Host ''
  Write-Host "$name 的官方安裝程式會從這個網址下載並執行：" -ForegroundColor Yellow
  Write-Host "  $url"
  Write-Host '  AI圓桌會議無法驗證這個腳本的內容，也沒有官方公布的雜湊可以比對。'
  if (Ask '確認要下載並執行嗎？') { powershell -NoProfile -ExecutionPolicy Bypass -Command "irm $url | iex" } else { Write-Host '已略過，之後可在 AI圓桌會議的「連線檢查」再安裝。' }
}
function Step($t) { Write-Host ''; Write-Host "▌ $t" -ForegroundColor Yellow }

Clear-Host
Write-Host ''
Write-Host '  AI圓桌會議  安裝程式' -ForegroundColor Cyan
Write-Host '  山姆蛋實驗室 SamEgg Lab 製作 · https://samtss.com/tools/ai-roundtable/'
Write-Host '  讓你訂閱的多個 AI 一起開會討論。每個 AI 都使用你自己的帳號與官方命令列工具。'
$build = Join-Path $src 'BUILD.json'
if (Test-Path $build) { $b = Get-Content $build -Raw | ConvertFrom-Json; Write-Host ("  版本 " + $b.version + " · 原始碼提交 " + $b.commit.Substring(0, 7)) }
Write-Host ''

# 1. Node.js
Step '1/5  檢查 Node.js'
if (-not (Has node)) {
  if (Has winget) {
    Write-Host '正在用 winget 安裝 Node.js LTS（OpenJS.NodeJS.LTS，可能會跳出系統確認視窗）…'
    winget install -e --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Has node) -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $env:Path += ";$env:ProgramFiles\nodejs" }
  }
  if (-not (Has node)) {
    Write-Host '沒辦法自動安裝 Node.js。請到開啟的網頁下載安裝「LTS」版本，裝完後再執行一次 Setup.bat。' -ForegroundColor Red
    Start-Process 'https://nodejs.org'; Read-Host '按 Enter 結束'; exit 1
  }
}
Write-Host ("Node.js 已就緒：" + (node --version)) -ForegroundColor Green

# 2. 複製程式檔（先請正在執行的 AI圓桌會議 自己結束）
Step '2/5  安裝 AI圓桌會議'
if (Test-Path (Join-Path $app 'app\server.js')) { node (Join-Path $app 'app\server.js') --stop | Out-Null }
New-Item -ItemType Directory -Force $app | Out-Null
foreach ($f in 'launch.vbs','start.bat','roundtable.ico','uninstall.bat','uninstall.ps1','README.txt','BUILD.json') { Copy-Item (Join-Path $src $f) $app -Force }
if (Test-Path (Join-Path $app 'app')) { Remove-Item (Join-Path $app 'app') -Recurse -Force }
Copy-Item (Join-Path $src 'app') $app -Recurse -Force
foreach ($old in 'server.js','index.html') { $o = Join-Path $app $old; if (Test-Path $o) { Remove-Item $o -Force } }   # v1.0 的舊檔
Write-Host "程式已安裝到 $app" -ForegroundColor Green
Write-Host "對話與設定會加密保存在 $data（v1.0 的 data.json 會在第一次開啟時自動轉移並加密）"

# 3. 選擇要用的 AI
Step '3/5  選擇你有訂閱的 AI（沒訂閱的選 N，之後也能用「手動貼上」）'
$chosen = @(); $logins = @()
New-Item -ItemType Directory -Force "$env:APPDATA\npm" | Out-Null
Add-UserPath "$env:APPDATA\npm"
if (Ask 'ChatGPT（用 ChatGPT 帳號登入 Codex CLI）') {
  if (-not (Has codex)) { Write-Host '用 npm 安裝 Codex CLI（@openai/codex，本版測試過 0.164.0）…'; npm install -g @openai/codex }
  $chosen += 'chatgpt'; $logins += ,@('ChatGPT', 'codex login', '在瀏覽器用你的 ChatGPT 帳號登入，看到登入成功後關掉那個視窗')
}
if (Ask 'Claude（用 Claude 帳號登入 Claude Code）') {
  if (-not (Has claude)) { Run-Installer 'Claude Code' 'https://claude.ai/install.ps1' }
  Add-UserPath "$env:USERPROFILE\.local\bin"
  $chosen += 'claude'; $logins += ,@('Claude', 'claude auth login', '依畫面用 Claude 帳號登入，成功後關掉那個視窗')
}
if (Ask 'Gemini（用 Google 帳號登入 Antigravity CLI；注意：本程式無法限制它的檔案權限）') {
  if (-not (Has agy)) { Run-Installer 'Antigravity CLI' 'https://antigravity.google/cli/install.ps1' }
  Add-UserPath "$env:LOCALAPPDATA\agy\bin"
  $chosen += 'gemini'; $logins += ,@('Gemini', 'agy', '選「Google OAuth」，用 Google 帳號登入，成功後關掉那個視窗')
}
if (Ask 'Grok（Grok CLI 尚未經過本程式實測）') {
  if (-not (Has grok)) { Run-Installer 'Grok CLI' 'https://x.ai/cli/install.ps1' }
  Add-UserPath "$env:USERPROFILE\.grok\bin"
  $chosen += 'grok'; $logins += ,@('Grok', 'grok', '依畫面用 Grok／X 帳號登入，成功後關掉那個視窗')
}
# 只記錄你選了哪些 AI，第一次開啟時套用（不寫入任何對話內容）
[IO.File]::WriteAllText((Join-Path $app 'first-run.json'), (@{ auto = $chosen } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))

# 4. 登入
Step '4/5  登入各家帳號'
Refresh-Path
foreach ($l in $logins) {
  Write-Host ''
  Write-Host ("接下來登入 " + $l[0] + "：" + $l[2])
  Read-Host '準備好了按 Enter'
  Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', $l[1] -Wait
}

# 5. 捷徑
Step '5/5  建立捷徑'
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  foreach ($n in '圓桌.lnk', 'AI討論室.lnk') { $old = Join-Path $dir $n; if (Test-Path $old) { Remove-Item $old -Force } }
  $lnk = $ws.CreateShortcut((Join-Path $dir 'AI圓桌會議.lnk'))
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = '"' + (Join-Path $app 'launch.vbs') + '"'
  $lnk.WorkingDirectory = $app
  $lnk.IconLocation = (Join-Path $app 'roundtable.ico') + ',0'
  $lnk.Description = 'AI圓桌會議 · 山姆蛋實驗室'
  $lnk.Save()
}
Write-Host '桌面和開始功能表都已加入「AI圓桌會議」。' -ForegroundColor Green

Write-Host ''
Write-Host '安裝完成！第一次開啟會先做「連線檢查」，按「測試」確認每個 AI 真的能回答。' -ForegroundColor Cyan
Write-Host '使用說明與常見問題：https://samtss.com/tools/ai-roundtable/'
if (Ask '現在打開 AI圓桌會議嗎？') { Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + (Join-Path $app 'launch.vbs') + '"') }

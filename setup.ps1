# AI圓桌會議 安裝程式（山姆蛋實驗室 SamEgg Lab）
$ErrorActionPreference = 'Continue'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $env:LOCALAPPDATA 'Roundtable'

function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Ask($q) { do { $a = Read-Host "$q  (Y/N)" } until ($a -match '^[YyNn]'); return $a -match '^[Yy]' }
function Add-UserPath($p) {
  $u = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $u) { $u = '' }
  if (-not ($u -split ';' | Where-Object { $_ -eq $p })) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $p), 'User') }
  if (-not ($env:Path -split ';' | Where-Object { $_ -eq $p })) { $env:Path += ";$p" }
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Run-Installer($url) { powershell -NoProfile -ExecutionPolicy Bypass -Command "irm $url | iex" }
function Step($t) { Write-Host ''; Write-Host "▌ $t" -ForegroundColor Yellow }

Clear-Host
Write-Host ''
Write-Host '  AI圓桌會議  安裝程式' -ForegroundColor Cyan
Write-Host '  山姆蛋實驗室 SamEgg Lab 製作 · https://samtss.com/tools/ai-roundtable/'
Write-Host '  讓你訂閱的多個 AI 一起開會討論。每個 AI 都使用你自己的訂閱帳號。'
Write-Host ''

# 1. Node.js
Step '1/5  檢查 Node.js'
if (-not (Has node)) {
  if (Has winget) {
    Write-Host '正在安裝 Node.js（可能會跳出系統確認視窗，請按「是」）…'
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Has node) -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $env:Path += ";$env:ProgramFiles\nodejs" }
  }
  if (-not (Has node)) {
    Write-Host '沒辦法自動安裝 Node.js。請到開啟的網頁下載安裝「LTS」版本，裝完後再執行一次 Setup.bat。' -ForegroundColor Red
    Start-Process 'https://nodejs.org'; Read-Host '按 Enter 結束'; exit 1
  }
}
Write-Host ("Node.js 已就緒：" + (node --version)) -ForegroundColor Green

# 2. 複製程式檔
Step '2/5  安裝 AI圓桌會議'
New-Item -ItemType Directory -Force $app | Out-Null
foreach ($f in 'server.js','index.html','launch.vbs','start.bat','roundtable.ico','uninstall.bat','uninstall.ps1') {
  Copy-Item (Join-Path $src $f) $app -Force
}
Write-Host "已安裝到 $app" -ForegroundColor Green

# 3. 選擇要用的 AI
Step '3/5  選擇你有訂閱的 AI（沒訂閱的選 N，之後也能手動貼上使用）'
$cmds = [ordered]@{ chatgpt = ''; claude = ''; grok = ''; gemini = '' }
$logins = @()
New-Item -ItemType Directory -Force "$env:APPDATA\npm" | Out-Null
Add-UserPath "$env:APPDATA\npm"

if (Ask 'ChatGPT（需要 Plus 或 Pro 訂閱）') {
  if (-not (Has codex)) { Write-Host '安裝 Codex CLI…'; npm install -g @openai/codex }
  $cmds.chatgpt = 'codex --search exec --skip-git-repo-check -s read-only -'
  $logins += ,@('ChatGPT', 'codex login', '在瀏覽器用你的 ChatGPT 帳號登入，看到登入成功後直接關掉那個視窗')
}
if (Ask 'Claude（需要 Pro 或 Max 訂閱）') {
  if (-not (Has claude)) { Write-Host '安裝 Claude Code…'; Run-Installer 'https://claude.ai/install.ps1' }
  Add-UserPath "$env:USERPROFILE\.local\bin"
  $cmds.claude = 'claude -p --max-turns 8 --allowedTools "WebSearch,WebFetch"'
  $logins += ,@('Claude', 'claude', '依畫面用 Claude 帳號登入，登入成功後直接關掉那個視窗')
}
if (Ask 'Gemini（需要 Google AI Pro 或 Ultra 訂閱）') {
  if (-not (Has agy)) { Write-Host '安裝 Antigravity CLI…'; Run-Installer 'https://antigravity.google/cli/install.ps1' }
  Add-UserPath "$env:LOCALAPPDATA\agy\bin"
  $cmds.gemini = 'agy -p {prompt}'
  $logins += ,@('Gemini', 'agy', '選「1. Google OAuth」，用 Google 帳號登入，成功後直接關掉那個視窗')
}
if (Ask 'Grok（需要 SuperGrok 或 X Premium+，部分方案可能無法使用）') {
  if (-not (Has grok)) { Write-Host '安裝 Grok CLI…'; Run-Installer 'https://x.ai/cli/install.ps1' }
  Add-UserPath "$env:USERPROFILE\.grok\bin"
  $cmds.grok = 'grok -p {prompt}'
  $logins += ,@('Grok', 'grok', '依畫面用 Grok／X 帳號登入，成功後直接關掉那個視窗')
}

# 第一次安裝才建立設定檔（重新安裝或更新時保留原本的對話與設定）
$data = Join-Path $app 'data.json'
if (-not (Test-Path $data)) {
  $names = @{ chatgpt = 'ChatGPT'; claude = 'Claude'; grok = 'Grok'; gemini = 'Gemini' }
  $ais = [ordered]@{}
  foreach ($k in $cmds.Keys) { $ais[$k] = [ordered]@{ name = $names[$k]; cmd = $cmds[$k]; role = '' } }
  $json = [ordered]@{ settings = [ordered]@{ ais = $ais }; projects = @() } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($data, $json, (New-Object Text.UTF8Encoding $false))
} else {
  Write-Host '保留你原本的對話與設定。' -ForegroundColor Green
}

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
  $old = Join-Path $dir '圓桌.lnk'; if (Test-Path $old) { Remove-Item $old -Force }
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
Write-Host '安裝完成！' -ForegroundColor Cyan
Write-Host '使用說明與常見問題：https://samtss.com/tools/ai-roundtable/'
if (Ask '現在打開 AI圓桌會議嗎？') { Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + (Join-Path $app 'launch.vbs') + '"') }

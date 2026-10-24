# AI圓桌會議 解除安裝：程式、對話紀錄、工作資料夾、CLI 登入分開處理
param([string]$App = (Join-Path $env:LOCALAPPDATA 'Roundtable'))
$data = Join-Path $env:LOCALAPPDATA 'AI-Roundtable'
function Ask($q) { do { $a = Read-Host "$q  (Y/N)" } until ($a -match '^[YyNn]'); return $a -match '^[Yy]' }
Write-Host ''
Write-Host '  AI圓桌會議 · 解除安裝' -ForegroundColor Cyan
Write-Host ''

# 請正在執行的 AI圓桌會議 自己結束（會先確認身分，不會關掉其他程式）
$server = Join-Path $App 'app\server.js'
if ((Test-Path $server) -and (Get-Command node -ErrorAction SilentlyContinue)) { node $server --stop | Out-Null }

# 1. 程式與捷徑
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  foreach ($n in 'AI圓桌會議.lnk', '圓桌.lnk', 'AI討論室.lnk') { $l = Join-Path $dir $n; if (Test-Path $l) { Remove-Item $l -Force } }
}
$legacy = Join-Path $App 'data.json'
if (Test-Path $legacy) {   # 還沒轉移的 v1.0 明文對話
  New-Item -ItemType Directory -Force $data | Out-Null
  Move-Item $legacy (Join-Path $data ('v1-data-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) -Force
  Write-Host "找到 v1.0 的舊對話（明文），已移到 $data 保留。" -ForegroundColor Yellow
}
Start-Sleep 1
Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "已移除程式與捷徑（$App）。" -ForegroundColor Green

# 2. 對話紀錄、設定與備份（加密保存）
Write-Host ''
Write-Host "對話紀錄、設定與備份在：$data"
if (Ask '要刪除對話紀錄、設定與所有備份嗎？（刪除後無法復原）') {
  foreach ($n in 'data.enc','data.json','key.dpapi','instance.lock') { $f = Join-Path $data $n; if (Test-Path $f) { Remove-Item $f -Force } }
  Remove-Item (Join-Path $data 'backups') -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem $data -Filter '*.corrupt-*' -ErrorAction SilentlyContinue | Remove-Item -Force
  Get-ChildItem $data -Filter 'v1-data-*.json' -ErrorAction SilentlyContinue | Remove-Item -Force
  Write-Host '已刪除對話紀錄與備份。' -ForegroundColor Green
} else { Write-Host '保留對話紀錄。重新安裝後會自動讀回。' }

# 3. AI 產生的檔案（工作資料夾）
$work = Join-Path $data 'workspaces'
if (Test-Path $work) {
  Write-Host ''
  Write-Host "AI 在討論中產生的檔案在：$work"
  if (Ask '要刪除這些檔案嗎？') { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '已刪除工作資料夾。' -ForegroundColor Green } else { Write-Host '保留工作資料夾。' }
}
if ((Test-Path $data) -and -not (Get-ChildItem $data -Force -ErrorAction SilentlyContinue)) { Remove-Item $data -Force }

# 4. 各家 CLI 與登入狀態：預設不動
Write-Host ''
Write-Host '各家 AI 的命令列工具（codex、claude、agy、grok）與它們的登入狀態沒有被移除，你仍可單獨使用。'
Write-Host '它們自己保存的資料：Claude Code 在 %USERPROFILE%\.claude、Codex 在 %USERPROFILE%\.codex、Antigravity 在 %USERPROFILE%\.gemini\antigravity-cli。'
if (Ask '要現在登出 Claude Code 與 Codex 嗎？') {
  if (Get-Command claude -ErrorAction SilentlyContinue) { claude auth logout }
  if (Get-Command codex -ErrorAction SilentlyContinue) { codex logout }
  Write-Host 'Antigravity 與 Grok 請依各自的說明登出。'
}
Write-Host ''
Write-Host '完成。' -ForegroundColor Green

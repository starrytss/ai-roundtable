# AI圓桌會議 解除安裝
$app = Join-Path $env:LOCALAPPDATA 'Roundtable'
Write-Host ''
Write-Host '  AI圓桌會議 · 解除安裝' -ForegroundColor Cyan
Write-Host ''
# 關掉正在執行的 AI圓桌會議
Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  foreach ($n in 'AI圓桌會議.lnk', '圓桌.lnk') { $l = Join-Path $dir $n; if (Test-Path $l) { Remove-Item $l -Force } }
}
$keep = (Read-Host '要保留你的對話紀錄嗎？（Y = 保留 data.json，N = 全部刪除）') -match '^[Yy]'
if ($keep) {
  Get-ChildItem $app -Exclude 'data.json' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "已移除 AI圓桌會議，對話紀錄保留在 $app\data.json" -ForegroundColor Green
} else {
  Start-Sleep 1
  Remove-Item $app -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '已完全移除 AI圓桌會議。' -ForegroundColor Green
}
Write-Host '各家 AI 的命令列工具（codex、claude、agy、grok）沒有移除，你之後仍可單獨使用。'

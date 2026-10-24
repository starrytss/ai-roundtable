# AI圓桌會議：建立桌面與開始功能表捷徑
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws   = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '')
)
foreach ($t in $targets) {
  $lnk = $ws.CreateShortcut((Join-Path $t 'AI圓桌會議.lnk'))
  $lnk.TargetPath       = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments        = '"' + (Join-Path $dir 'launch.vbs') + '"'
  $lnk.WorkingDirectory = $dir
  $lnk.IconLocation     = (Join-Path $dir 'roundtable.ico') + ',0'
  $lnk.Description      = 'AI圓桌會議 · 山姆蛋實驗室'
  $lnk.Save()
  # 移除舊名稱的捷徑
  foreach ($n in '圓桌.lnk', 'AI討論室.lnk') { $old = Join-Path $t $n; if (Test-Path $old) { Remove-Item $old } }
}
Write-Host ''
Write-Host '完成！桌面和開始功能表都已加入「AI圓桌會議」。' -ForegroundColor Green
Write-Host '以後雙擊「AI圓桌會議」就能開啟，關掉視窗後程式會自動結束。'
Write-Host ''

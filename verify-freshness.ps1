Set-Location 'C:\Users\james\Desktop\LCS\lcs-fantasy'

$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $_.CommandLine -like '*lcs-fantasy*next*dev*' -or
    $_.CommandLine -like '*lcs-fantasy*run dev*'
  }
foreach ($proc in $old) {
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

$stdout = 'C:\Users\james\Desktop\LCS\lcs-fantasy\dev-4310.out.log'
$stderr = 'C:\Users\james\Desktop\LCS\lcs-fantasy\dev-4310.err.log'
Remove-Item $stdout,$stderr -ErrorAction SilentlyContinue
$p = Start-Process -FilePath npm.cmd -ArgumentList 'run','dev','--','--port','4310' -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4310' -Method Get -TimeoutSec 2 | Out-Null
    $ready = $true
    break
  } catch {}
}
if (-not $ready) {
  Write-Output 'SERVER_NOT_READY'
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

try {
  $headers = @{ 'x-sync-token' = 'local-sync-token' }
  $sync1 = Invoke-RestMethod -Method Post -Uri 'http://localhost:4310/api/admin/sync-leaguepedia' -Headers $headers
  Start-Sleep -Milliseconds 300
  $sync2 = Invoke-RestMethod -Method Post -Uri 'http://localhost:4310/api/admin/sync-leaguepedia' -Headers $headers
  $status = Invoke-RestMethod -Method Get -Uri 'http://localhost:4310/api/snapshot-status'

  [PSCustomObject]@{
    sync1_updated = $sync1.updated
    sync1_revision = $sync1.sourceRevisionId
    sync2_updated = $sync2.updated
    sync2_revision = $sync2.sourceRevisionId
    status_revision = $status.sourceRevisionId
    status_isStale = $status.isStale
    status_ageMinutes = $status.ageMinutes
  } | ConvertTo-Json -Compress
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

$projectPath = (Resolve-Path ".").Path
$lockPath = Join-Path $projectPath ".next\\dev\\lock"
$lightningCssWinPackageDir = Join-Path $projectPath "node_modules\\lightningcss-win32-x64-msvc"
$patterns = @(
  "*$projectPath*next*dev*"
)

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) {
      return $false
    }
    foreach ($pattern in $patterns) {
      if ($cmd -like $pattern) {
        return $true
      }
    }
    return $false
  }

$stoppedCount = @($procs).Count

foreach ($proc in @($procs)) {
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

$lockRemoved = $false
if (Test-Path $lockPath) {
  Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
  $lockRemoved = -not (Test-Path $lockPath)
}

[PSCustomObject]@{
  stopped = $stoppedCount
  lockRemoved = $lockRemoved
  lightningCssWinInstalled = (Test-Path $lightningCssWinPackageDir)
  lockPath = $lockPath
} | ConvertTo-Json -Compress

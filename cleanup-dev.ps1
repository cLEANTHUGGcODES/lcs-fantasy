$projectPath = (Resolve-Path ".").Path
$lockPath = Join-Path $projectPath ".next\\dev\\lock"
$layoutCssPath = Join-Path $projectPath ".next\\dev\\static\\css\\app\\layout.css"
$appCssPath = Join-Path $projectPath ".next\\dev\\static\\css\\app"
$cssPath = Join-Path $projectPath ".next\\dev\\static\\css"
$devPath = Join-Path $projectPath ".next\\dev"
$lightningCssWinPackageDir = Join-Path $projectPath "node_modules\\lightningcss-win32-x64-msvc"
$patterns = @(
  "*$projectPath*node_modules*next*",
  "*$projectPath*run-next-with-css-wasm*",
  "*$projectPath*.next*"
)

function Test-PathSafe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  try {
    return [bool](Get-Item -LiteralPath $Path -Force -ErrorAction Stop)
  } catch [System.UnauthorizedAccessException] {
    # Treat access-denied as "exists" so cleanup retries can run.
    return $true
  } catch {
    return $false
  }
}

function Clear-ReadOnlyRecursively {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-PathSafe -Path $Path)) {
    return
  }

  $root = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -ne $root) {
    try {
      $root.IsReadOnly = $false
    } catch {
      # Ignore attribute issues.
    }
  }

  Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object {
      try {
        $_.IsReadOnly = $false
      } catch {
        # Ignore attribute issues.
      }
    }
}

function Remove-PathWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [switch]$Directory,
    [int]$Attempts = 10
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    if (-not (Test-PathSafe -Path $Path)) {
      return $true
    }

    try {
      Clear-ReadOnlyRecursively -Path $Path
      if ($Directory) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      } else {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
      }
    } catch {
      # Keep retrying; transient EPERM locks often clear quickly on Windows.
    }

    Start-Sleep -Milliseconds (120 * $attempt)
  }

  return -not (Test-PathSafe -Path $Path)
}

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

Start-Sleep -Milliseconds 350

$lockRemoved = $false
if (Test-PathSafe -Path $lockPath) {
  $lockRemoved = Remove-PathWithRetry -Path $lockPath
}

[bool]$layoutCssRemoved = $true
if (Test-PathSafe -Path $layoutCssPath) {
  $layoutCssRemoved = Remove-PathWithRetry -Path $layoutCssPath
}

[bool]$appCssRemoved = $true
if (Test-PathSafe -Path $appCssPath) {
  $appCssRemoved = Remove-PathWithRetry -Path $appCssPath -Directory
}

[bool]$cssRemoved = $true
if (Test-PathSafe -Path $cssPath) {
  $cssRemoved = Remove-PathWithRetry -Path $cssPath -Directory
}

[bool]$devRemoved = $true
if (Test-PathSafe -Path $devPath) {
  $devRemoved = Remove-PathWithRetry -Path $devPath -Directory
}

$staleArtifactsRemoved = $layoutCssRemoved -and $appCssRemoved -and $cssRemoved -and $devRemoved

[PSCustomObject]@{
  stopped = $stoppedCount
  lockRemoved = $lockRemoved
  layoutCssRemoved = $layoutCssRemoved
  appCssRemoved = $appCssRemoved
  cssRemoved = $cssRemoved
  devRemoved = $devRemoved
  staleArtifactsRemoved = $staleArtifactsRemoved
  lightningCssWinInstalled = (Test-PathSafe -Path $lightningCssWinPackageDir)
  lockPath = $lockPath
  layoutCssPath = $layoutCssPath
} | ConvertTo-Json -Compress

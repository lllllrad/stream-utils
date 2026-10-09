param(
  [Parameter(Mandatory)][ValidateSet('start', 'stop', 'status', 'restart', 'logs')][string]$Action,
  [ValidateSet('native', 'pixels')][string]$Mode = 'native'
)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$entrypoint = if ($Mode -eq 'native') { Join-Path $projectDir 'obs-camera-watchdog-native.js' } else { Join-Path $projectDir 'obs-camera-watchdog.js' }
$logFile = Join-Path $projectDir 'watchdog.log'
$configFile = if ($env:OBS_WATCHDOG_CONFIG) { $env:OBS_WATCHDOG_CONFIG } else { Join-Path $projectDir 'config.local.json' }
if (Test-Path -LiteralPath $configFile) {
  $config = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
  if ($config.logFile) {
    $logFile = if ([IO.Path]::IsPathRooted($config.logFile)) { $config.logFile } else { Join-Path (Split-Path ([IO.Path]::GetFullPath($configFile)) -Parent) $config.logFile }
  }
}

function Get-WatchdogProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains('"' + $entrypoint + '"') -and $_.CommandLine -notmatch '\srecover\s'
  }
}

if ($Action -eq 'logs') {
  if (!(Test-Path -LiteralPath $logFile)) { throw "No log yet: $logFile" }
  Get-Content -LiteralPath $logFile -Tail 20 -Wait
  exit
}
$running = @(Get-WatchdogProcess)
if ($Action -eq 'status') {
  if ($running.Count) { Write-Output "Running (PID $($running.ProcessId -join ', '))" } else { Write-Output 'Stopped' }
  exit
}
if ($Action -in @('stop', 'restart')) {
  $running | ForEach-Object { Stop-Process -Id $_.ProcessId }
  if ($Action -eq 'stop') { Write-Output 'Stopped'; exit }
  Start-Sleep -Milliseconds 250
  $running = @(Get-WatchdogProcess)
}
if ($running.Count) { Write-Output "Already running (PID $($running.ProcessId -join ', '))"; exit }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$envFile = Join-Path $projectDir '.env'
Start-Process -FilePath $nodePath -ArgumentList @("--env-file-if-exists=`"$envFile`"", "`"$entrypoint`"") -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectDir "$Mode.stdout.log") -RedirectStandardError (Join-Path $projectDir "$Mode.stderr.log")
Start-Sleep -Milliseconds 1000
$started = @(Get-WatchdogProcess)
if (!$started.Count) { throw "Watchdog exited; inspect $Mode.stderr.log" }
Write-Output "Started (PID $($started.ProcessId -join ', '))"

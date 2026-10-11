param(
  [Parameter(Mandatory)][string]$ObsBinDir
)
$ErrorActionPreference = 'Stop'
$obsBin = (Resolve-Path -LiteralPath $ObsBinDir).Path
$coreFile = Join-Path $obsBin 'obs.dll'
if (!(Test-Path -LiteralPath $coreFile)) { throw "obs.dll not found in $obsBin" }
$outputDir = Join-Path $PSScriptRoot 'build'
$pluginFile = Join-Path $outputDir 'frame-arrival-probe.dll'
if (!(Test-Path -LiteralPath $pluginFile)) { throw 'Build the probe with build.ps1 -Test first' }
if ($obsBin -match '[^\x00-\x7f]' -or $pluginFile -match '[^\x00-\x7f]') {
  throw 'This optional harness requires ASCII installation and workspace paths; UTF-8 source names are tested separately'
}
$testFile = Join-Path $outputDir 'probe-obs-test.exe'
& zig cc -target x86_64-windows-gnu -O2 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'test-obs.c') -o $testFile
if ($LASTEXITCODE -ne 0) { throw 'Installed OBS test build failed' }
$heartbeatDir = Join-Path $outputDir ('obs-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $heartbeatDir | Out-Null
try {
  $testLog = Join-Path $outputDir 'installed-obs-smoke.log'
  try {
    & $testFile $obsBin $pluginFile $heartbeatDir *> $testLog
    $testExit = $LASTEXITCODE
  } finally {
    Get-Content -LiteralPath $testLog -Tail 20
    Write-Output "Full OBS core test log: $testLog"
  }
  if ($testExit -ne 0) { throw "Installed OBS smoke test failed (exit $testExit)" }
  if (@(Get-ChildItem -LiteralPath $heartbeatDir -Force).Count) { throw 'Unexpected heartbeat files from unattached test filters' }
} finally {
  # Remove only an empty, uniquely created test directory. Preserve failures for inspection.
  if (!(Get-ChildItem -LiteralPath $heartbeatDir -Force)) { Remove-Item -LiteralPath $heartbeatDir }
}

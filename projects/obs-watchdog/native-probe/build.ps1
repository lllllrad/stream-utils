param([switch]$Test)
$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$outputFile = Join-Path $outputDir 'frame-arrival-probe.dll'
& zig cc -target x86_64-windows-gnu -shared -O2 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'frame_arrival_probe_native.c') -o $outputFile
if ($LASTEXITCODE -ne 0) { throw 'Native probe build failed' }
Write-Output $outputFile
if ($Test) {
  $testFile = Join-Path $outputDir 'probe-test.exe'
  & zig cc -target x86_64-windows-gnu -O2 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'test.c') -o $testFile
  if ($LASTEXITCODE -ne 0) { throw 'Native probe test build failed' }
  & $testFile
  if ($LASTEXITCODE -ne 0) { throw 'Native probe tests failed' }
}

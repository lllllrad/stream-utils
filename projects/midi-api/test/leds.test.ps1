$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../native/LaunchpadLeds.cs')
foreach ($rgb in @(@(63,0,0), @(0,0,63))) {
    $bytes = [StreamUtils.LaunchpadLeds]::Encode($rgb[0], $rgb[1], $rgb[2])
    if ($bytes.Length -ne 328 -or $bytes[0] -ne 240 -or $bytes[327] -ne 247) { throw 'Invalid SysEx framing' }
    $leds = @()
    for ($index = 7; $index -lt 327; $index += 4) {
        $leds += $bytes[$index]
        if ($bytes[$index+1] -ne $rgb[0] -or $bytes[$index+2] -ne $rgb[1] -or $bytes[$index+3] -ne $rgb[2]) { throw 'Incorrect LED RGB value' }
    }
    if (@($leds | Select-Object -Unique).Count -ne 80 -or $leds[0] -ne 11 -or $leds[79] -ne 98) { throw 'Incorrect LED address map' }
}
$rejected = $false
try { [void][StreamUtils.LaunchpadLeds]::Encode(64,0,0) } catch { $rejected = $true }
if (-not $rejected) { throw 'Out of range brightness was accepted' }
Write-Output 'LED encoder harness passed. No MIDI devices were opened.'

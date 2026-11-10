param([Parameter(Mandatory = $true)][string]$WarudoDataDirectory)
$ErrorActionPreference = 'Stop'
$dataDirectory = (Resolve-Path -LiteralPath $WarudoDataDirectory).Path
if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'Scenes'))) {
    throw 'Select the Warudo StreamingAssets data directory containing Scenes and Playground.'
}
$playgroundDirectory = Join-Path $dataDirectory 'Playground'
New-Item -ItemType Directory -Path $playgroundDirectory -Force | Out-Null
$sourceFile = Join-Path $PSScriptRoot '../warudo/MidiApiLeapMotionGate.cs'
$destinationFile = Join-Path $playgroundDirectory 'MidiApiLeapMotionGate.cs'
Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -Force
Write-Output "Installed: $destinationFile"
Write-Output 'In Warudo, add the MIDI API Leap Motion Gate asset, then save the scene.'

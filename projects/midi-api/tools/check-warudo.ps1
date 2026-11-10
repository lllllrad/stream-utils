param([Parameter(Mandatory = $true)][string]$WarudoDataDirectory, [switch]$Test)
$ErrorActionPreference = 'Stop'
$dataDirectory = (Resolve-Path -LiteralPath $WarudoDataDirectory).Path
$managedDirectory = Join-Path (Split-Path $dataDirectory -Parent) 'Managed'
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$sdkDirectory = Get-ChildItem (Join-Path (Split-Path $dotnet -Parent) 'sdk') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $sdkDirectory) { throw '.NET SDK is required for the compile check.' }
$compiler = Join-Path $sdkDirectory.FullName 'Roslyn/bincore/csc.dll'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $projectDirectory 'build'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$references = @('mscorlib.dll', 'netstandard.dll', 'System.dll', 'System.Core.dll', 'Warudo.Core.dll',
    'UnityEngine.CoreModule.dll', 'UnityEngine.UnityWebRequestModule.dll', 'UnityEngine.JSONSerializeModule.dll', 'websocket-sharp.dll') |
    ForEach-Object { '-r:' + (Join-Path $managedDirectory $_) }
& $dotnet $compiler -nologo -noconfig -nostdlib+ -target:library ('-out:' + (Join-Path $outputDirectory 'MidiApiLeapMotionGate.dll')) @references (Join-Path $projectDirectory 'warudo/MidiApiLeapMotionGate.cs')
if ($LASTEXITCODE -ne 0) { throw 'Warudo integration compile check failed.' }
Write-Output 'Warudo integration compiled successfully. No files were installed into Warudo.'
if ($Test) {
    $testReferences = @('mscorlib.dll', 'System.dll', 'System.Core.dll') |
        ForEach-Object { '-r:' + (Join-Path $managedDirectory $_) }
    $testExecutable = Join-Path $outputDirectory 'warudo-harness.exe'
    & $dotnet $compiler -nologo -noconfig -nostdlib+ -target:exe ('-out:' + $testExecutable) @testReferences (Join-Path $projectDirectory 'warudo/MidiApiLeapMotionGate.cs') (Join-Path $projectDirectory 'test/warudo-harness.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Warudo harness compilation failed.' }
    & $testExecutable
    if ($LASTEXITCODE -ne 0) { throw 'Warudo harness failed.' }
}

param([switch]$List, [string]$DeviceName = 'Launchpad MK2', [string]$DeviceInterface = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Send-Event($value) {
    [Console]::WriteLine((ConvertTo-Json -InputObject $value -Compress -Depth 6))
}
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'WinMm.cs')
    $devices = @([StreamUtils.MidiInput]::Devices())
    Send-Event @{ type = 'devices'; devices = $devices }
    if ($List) { exit 0 }
    $matches = @($devices | Where-Object {
        if ($DeviceInterface) { $_.deviceInterface -eq $DeviceInterface }
        else { $_.name -ceq $DeviceName }
    })
    if ($matches.Count -ne 1) { throw "Expected exactly one selected MIDI input; found $($matches.Count)" }
    $selected = $matches[0]
    $midi = New-Object StreamUtils.MidiInput([uint32]$selected.id)
    try {
        Send-Event @{ type = 'connected'; device = $selected }
        $nextInventory = [DateTime]::UtcNow.AddSeconds(1)
        $nextHeartbeat = [DateTime]::UtcNow
        while ($true) {
            foreach ($message in $midi.Drain()) {
                if ($message.status -eq 0) { throw 'MIDI input reported an error or buffer overflow' }
                Send-Event @{ type = 'midi'; status = $message.status; data1 = $message.data1; data2 = $message.data2 }
            }
            $now = [DateTime]::UtcNow
            if ($now -ge $nextInventory) {
                $current = @([StreamUtils.MidiInput]::Devices())
                $stillPresent = @($current | Where-Object {
                    $_.id -eq $selected.id -and $_.name -ceq $selected.name -and $_.deviceInterface -eq $selected.deviceInterface
                })
                if ($stillPresent.Count -ne 1 -or $current.Count -ne $devices.Count) { throw 'MIDI device inventory changed; reconnecting' }
                $nextInventory = $now.AddSeconds(1)
            }
            if ($now -ge $nextHeartbeat) {
                Send-Event @{ type = 'heartbeat' }
                $nextHeartbeat = $now.AddMilliseconds(250)
            }
            Start-Sleep -Milliseconds 5
        }
    } finally { $midi.Dispose() }
} catch {
    Send-Event @{ type = 'error'; message = $_.Exception.Message }
    exit 1
}

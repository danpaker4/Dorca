$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Run this native-focus diagnostic only on an isolated Windows CI runner'
}

$fixtureName = 'dorca-notepad-diagnostic-' + [guid]::NewGuid().ToString('N') + '.txt'
$fixture = Join-Path $env:RUNNER_TEMP $fixtureName
$operationFile = Join-Path $env:RUNNER_TEMP ('notepad-handshake-' + [guid]::NewGuid() + '.json')
$probeProcess = $null
try {
    Set-Content -LiteralPath $fixture -Encoding UTF8 -Value 'seed'
    Set-Content -LiteralPath $operationFile -Encoding UTF8 -Value '{"tool":"handshake"}'
    $handshake = . (Join-Path $PSScriptRoot '../../native/computer-use-windows/runtime.ps1') -OperationPath $operationFile
    if (-not ($handshake | ConvertFrom-Json).ok) { throw 'Provider handshake failed' }
    $launched = Start-Process notepad.exe -ArgumentList ('"' + $fixture + '"') -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $probeProcess = Get-Process notepad -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle.Contains($fixtureName) } | Select-Object -First 1
        if ($null -eq $probeProcess) { Start-Sleep -Milliseconds 200 }
    } while ($null -eq $probeProcess -and [DateTime]::UtcNow -lt $deadline)
    if ($null -eq $probeProcess) { throw 'Test-owned Notepad window was not found' }
    $selector = 'pid:' + $probeProcess.Id
    Restore-OrcaWindow $probeProcess
    $root = Get-OrcaRootElement $probeProcess
    $condition = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::ControlTypeProperty,
        [Windows.Automation.ControlType]::Document
    )
    $document = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $document) { throw 'Notepad document was not found' }
    $document.SetFocus()
    $patterns = @($document.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
    Write-Output ('Notepad document patterns: ' + ($patterns -join ', '))
    foreach ($tool in @('paste_text', 'type_text')) {
        $marker = 'dorca-notepad-' + $tool + '-' + [guid]::NewGuid().ToString('N')
        $selected = Invoke-OrcaOperation @{ tool = 'hotkey'; app = $selector; key = 'Ctrl+a'; noScreenshot = $true; restoreWindow = $true }
        $action = Invoke-OrcaOperation @{ tool = $tool; app = $selector; text = $marker; noScreenshot = $true; restoreWindow = $true }
        $saved = Invoke-OrcaOperation @{ tool = 'hotkey'; app = $selector; key = 'Ctrl+s'; noScreenshot = $true; restoreWindow = $true }
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $savedText = [IO.File]::ReadAllText($fixture)
            if ($savedText -cne $marker) { Start-Sleep -Milliseconds 100 }
        } while ($savedText -cne $marker -and [DateTime]::UtcNow -lt $deadline)
        $rawText = $document.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(1000)
        $fresh = New-OrcaSnapshot $selector $false
        $report = [ordered]@{
            inputMethod = $tool
            savedDocumentMatches = $savedText -ceq $marker
            textPatternContainsText = $rawText.Contains($marker)
            actionSnapshotContainsText = ($action.snapshot.treeLines -join "`n").Contains($marker)
            freshSnapshotContainsText = ($fresh.treeLines -join "`n").Contains($marker)
            providerValueContainsText = (Get-OrcaValueText $document).Contains($marker)
        }
        Write-Output ($report | ConvertTo-Json -Compress)
        if (-not $report.savedDocumentMatches -or -not $report.textPatternContainsText) {
            throw 'Input or native TextPattern read failed; the missing-reader hypothesis is not sufficient'
        }
    }
} finally {
    if ($null -ne $probeProcess) { Stop-Process -Id $probeProcess.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $fixture, $operationFile -Force -ErrorAction SilentlyContinue
}

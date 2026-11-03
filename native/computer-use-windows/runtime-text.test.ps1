$ErrorActionPreference = 'Stop'

function Assert-TextEqual($Actual, $Expected, [string]$Label) {
    if ($Actual -cne $Expected) { throw "$Label expected '$Expected', received '$Actual'" }
}

function New-TextTestElement([string]$Text, [bool]$HasValue = $false, [bool]$HasText = $true) {
    $range = [pscustomobject]@{ Text = $Text; RequestedLength = 0 }
    $range | Add-Member -MemberType ScriptMethod -Name GetText -Value {
        param([int]$limit)
        $this.RequestedLength = $limit
        if ($this.Text.Length -gt $limit) { return $this.Text.Substring(0, $limit) }
        $this.Text
    }
    $element = [pscustomobject]@{
        Current = [pscustomobject]@{
            IsPassword = $false
            Name = 'Text Editor'
            LocalizedControlType = 'document'
            ControlType = [pscustomobject]@{ ProgrammaticName = 'ControlType.Document' }
            AutomationId = '15'
            ClassName = 'RichEditD2DPT'
            NativeWindowHandle = 0
        }
        HasValue = $HasValue
        HasText = $HasText
        Value = $Text
        TextReads = 0
        ValueReads = 0
        TextPattern = [pscustomobject]@{ DocumentRange = $range }
    }
    $element | Add-Member -MemberType ScriptMethod -Name GetCurrentPattern -Value {
        param($pattern)
        if ($pattern -eq [Windows.Automation.ValuePattern]::Pattern -and $this.HasValue) {
            $this.ValueReads++
            return [pscustomobject]@{ Current = [pscustomobject]@{ Value = $this.Value } }
        }
        if ($pattern -eq [Windows.Automation.TextPattern]::Pattern -and $this.HasText) {
            $this.TextReads++
            return $this.TextPattern
        }
        throw [System.InvalidOperationException]::new('Unsupported pattern')
    }
    $element | Add-Member -MemberType ScriptMethod -Name GetSupportedPatterns -Value { @() }
    $element | Add-Member -MemberType ScriptMethod -Name GetRuntimeId -Value { ,@(1) }
    $element | Add-Member -MemberType ScriptMethod -Name FindAll -Value { param($scope, $condition) @() }
    $element
}

$operation = Join-Path ([IO.Path]::GetTempPath()) ('orca-runtime-text-test-' + [guid]::NewGuid() + '.json')
try {
    Set-Content -LiteralPath $operation -Encoding UTF8 -Value '{"tool":"handshake"}'
    $handshake = . (Join-Path $PSScriptRoot 'runtime.ps1') -OperationPath $operation
    Assert-TextEqual ($handshake | ConvertFrom-Json).ok $true 'provider handshake'

    $marker = 'orca-windows-paste-repro'
    $document = New-TextTestElement $marker
    $tree = Render-OrcaTree $document $null
    Assert-TextEqual ($tree.lines -join "`n") "0 document Text Editor $marker" 'TextPattern document snapshot'

    $unicode = 'caf' + [char]0x00E9 + ' ' + [char]0x03A9 + ' ' + [char]0x6F22 + [char]0x5B57
    Assert-TextEqual (Get-OrcaValueText (New-TextTestElement $unicode)) $unicode 'Unicode document text'

    $valueElement = New-TextTestElement 'value content' $true
    $valueElement.TextPattern.DocumentRange.Text = 'different text content'
    Assert-TextEqual (Get-OrcaValueText $valueElement) 'value content' 'ValuePattern priority'
    Assert-TextEqual $valueElement.TextReads 0 'ValuePattern avoids unnecessary TextPattern calls'

    $largeDocument = New-TextTestElement ('x' * ($TextLimit + 20))
    Assert-TextEqual (Get-OrcaValueText $largeDocument) (('x' * $TextLimit) + '...') 'document truncation'
    Assert-TextEqual $largeDocument.TextPattern.DocumentRange.RequestedLength ($TextLimit + 1) 'bounded document read'

    $sensitive = New-TextTestElement 'hidden password'
    $sensitive.Current.IsPassword = $true
    Assert-TextEqual (Get-OrcaValueText $sensitive) '[redacted]' 'sensitive document redaction'
    Assert-TextEqual $sensitive.TextReads 0 'sensitive document is never read'
    Assert-TextEqual (Get-OrcaValueText (New-TextTestElement '' $false $false)) '' 'unsupported patterns'
    Assert-TextEqual (Get-OrcaValueText (New-TextTestElement '')) '' 'empty document'
    Write-Output 'windows-text-pattern-tests-ok'
} finally {
    Remove-Item -LiteralPath $operation -Force -ErrorAction SilentlyContinue
}

param([string]$Serial, [string]$ApkPath, [string]$EvidencePath)

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not $ApkPath) {
    $manifestPath = Join-Path $project 'artifacts/latest-android-build.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Pass -ApkPath or create artifacts/latest-android-build.json first.' }
    $candidates = @((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).packages | Where-Object { $_.path -match 'x86_64-debug\.apk$' })
    if ($candidates.Count -ne 1) { throw 'Latest Android manifest must contain one x86_64 debug APK; otherwise pass -ApkPath.' }
    $ApkPath = $candidates[0].path
}
$apk = [IO.Path]::GetFullPath($ApkPath)
$out = if ($EvidencePath) { [IO.Path]::GetFullPath($EvidencePath) } else { Join-Path $project 'artifacts/android-lifecycle-cli-evidence.json' }
$package = 'app.tano.local'
$activity = "$package/$package.MainActivity"
if (-not (Test-Path -LiteralPath $adb)) { throw "adb not found: $adb" }
if (-not (Test-Path -LiteralPath $apk)) { throw "Build the x86_64 debug APK first: $apk" }

function Invoke-Adb([string[]]$Arguments) {
    $output = & $adb @Arguments
    if ($LASTEXITCODE -ne 0) { throw "adb failed ($LASTEXITCODE): adb $($Arguments -join ' ')" }
    return @($output)
}

$deviceLines = Invoke-Adb @('devices')
$devices = @($deviceLines | Select-String '^([^\s]+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if (-not $Serial) {
    if ($devices.Count -ne 1) { throw 'Connect exactly one device or pass -Serial.' }
    $Serial = $devices[0]
}
if ($devices -notcontains $Serial) { throw "Device is not attached: $Serial" }

$evidence = [ordered]@{
    startedAt = [DateTime]::UtcNow.ToString('o')
    status = 'running'
    serial = $Serial
    package = $package
    apk = $apk.Replace('\', '/')
    apkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
    Invoke-Adb @('-s', $Serial, 'install', '-r', $apk) | Out-Null
    Invoke-Adb @('-s', $Serial, 'logcat', '-c') | Out-Null
    Invoke-Adb @('-s', $Serial, 'shell', 'am', 'force-stop', $package) | Out-Null
    Invoke-Adb @('-s', $Serial, 'shell', 'am', 'start', '-n', $activity) | Out-Null
    Start-Sleep -Seconds 4
    $evidence.pidAfterStart = ((& $adb @('-s', $Serial, 'shell', 'pidof', $package)) -join '').Trim()
    $evidence.focusAfterStart = ((& $adb @('-s', $Serial, 'shell', 'dumpsys', 'activity', 'activities') | Select-String 'mCurrentFocus' | Select-Object -First 1) -join '').Trim()
    if (-not $evidence.pidAfterStart) { throw 'Application did not remain running after launch' }
    if ($evidence.focusAfterStart -notlike "*$package*MainActivity*") { throw 'Application did not gain focus after launch' }

    Invoke-Adb @('-s', $Serial, 'shell', 'input', 'keyevent', 'HOME') | Out-Null
    Start-Sleep -Seconds 2
    $evidence.focusAfterHome = ((& $adb @('-s', $Serial, 'shell', 'dumpsys', 'activity', 'activities') | Select-String 'mCurrentFocus' | Select-Object -First 1) -join '').Trim()
    if (-not $evidence.focusAfterHome -or $evidence.focusAfterHome -like "*$package*MainActivity*") { throw 'Application did not enter background after HOME' }
    Invoke-Adb @('-s', $Serial, 'shell', 'am', 'start', '-n', $activity) | Out-Null
    Start-Sleep -Seconds 3
    $evidence.focusAfterForeground = ((& $adb @('-s', $Serial, 'shell', 'dumpsys', 'activity', 'activities') | Select-String 'mCurrentFocus' | Select-Object -First 1) -join '').Trim()
    if ($evidence.focusAfterForeground -notlike "*$package*MainActivity*") { throw 'Application did not regain foreground focus' }

    Invoke-Adb @('-s', $Serial, 'shell', 'am', 'force-stop', $package) | Out-Null
    Start-Sleep -Seconds 2
    $evidence.pidAfterForceStop = ((& $adb @('-s', $Serial, 'shell', 'pidof', $package)) -join '').Trim()
    if ($evidence.pidAfterForceStop) { throw 'Application process survived force-stop' }
    Invoke-Adb @('-s', $Serial, 'shell', 'am', 'start', '-n', $activity) | Out-Null
    Start-Sleep -Seconds 4
    $evidence.pidAfterRelaunch = ((& $adb @('-s', $Serial, 'shell', 'pidof', $package)) -join '').Trim()
    $evidence.focusAfterRelaunch = ((& $adb @('-s', $Serial, 'shell', 'dumpsys', 'activity', 'activities') | Select-String 'mCurrentFocus' | Select-Object -First 1) -join '').Trim()
    if (-not $evidence.pidAfterRelaunch) { throw 'Application did not remain running after relaunch' }
    if ($evidence.focusAfterRelaunch -notlike "*$package*MainActivity*") { throw 'Application did not regain focus after relaunch' }
    $fatal = @(@($evidence.pidAfterStart, $evidence.pidAfterRelaunch) | Select-Object -Unique | ForEach-Object {
        Invoke-Adb @('-s', $Serial, 'logcat', '-d', '--pid', $_) | Select-String 'FATAL EXCEPTION|Fatal signal|AndroidRuntime' | Where-Object { $_ -notmatch 'VM exiting' }
    })
    $evidence.appFatalLines = if ($fatal.Count) { @($fatal | ForEach-Object { $_.ToString() }) } else { @('none') }
    if ($fatal.Count) { throw 'Application crash entries found in logcat' }
    $evidence.status = 'passed'
} catch {
    $evidence.status = 'failed'
    $evidence.error = $_.Exception.Message
    throw
} finally {
    $evidence.finishedAt = [DateTime]::UtcNow.ToString('o')
    $evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding utf8
    Write-Output ($evidence | ConvertTo-Json -Compress)
}

param(
    [ValidateSet('check', 'init', 'build', 'dev')][string]$Action = 'check',
    [ValidateSet('aarch64', 'x86_64')][string]$Target = 'aarch64',
    [string]$Device,
    [switch]$DebugBuild
)
$ErrorActionPreference = 'Stop'
$tanoProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $tanoProject
if (-not $env:JAVA_HOME) {
    $tanoJbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if (Test-Path -LiteralPath (Join-Path $tanoJbr 'bin\java.exe')) { $env:JAVA_HOME = $tanoJbr }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk\28.2.13676358' }
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17+ or install Android Studio. See docs/mobile.md.' }
foreach ($tanoRequired in @((Join-Path $env:JAVA_HOME 'bin\java.exe'), (Join-Path $env:NDK_HOME 'source.properties'), (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'), (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt2.exe'), (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\aapt2.exe'))) {
    if (-not (Test-Path -LiteralPath $tanoRequired)) { throw "Android prerequisite missing: $tanoRequired. See docs/mobile.md." }
}
if ($Action -eq 'check') {
    & (Join-Path $env:JAVA_HOME 'bin\java.exe') -version
    rustup target list --installed
    Write-Output "Android SDK: $env:ANDROID_HOME"
    Write-Output "Android NDK: $env:NDK_HOME"
    exit 0
}
if ($Action -eq 'init') { npm run tauri -w '@tano/client' -- android init --ci --skip-targets-install }
elseif ($Action -eq 'build') {
    # Repacking an existing APK can retain orphan native-library blobs. Remove
    # only the generated archive; Gradle's compilation caches remain reusable.
    $tanoFlavor = if ($DebugBuild) { 'debug' } else { 'release' }
    $tanoApkName = if ($DebugBuild) { 'app-universal-debug.apk' } else { 'app-universal-release-unsigned.apk' }
    $tanoGeneratedApk = Join-Path $tanoProject "apps\client\src-tauri\gen\android\app\build\outputs\apk\universal\$tanoFlavor\$tanoApkName"
    if (Test-Path -LiteralPath $tanoGeneratedApk -PathType Leaf) {
        Remove-Item -LiteralPath $tanoGeneratedApk
    }
    $tanoArguments = @('run', 'tauri', '-w', '@tano/client', '--', 'android', 'build', '--apk', '--target', $Target, '--ci')
    if ($DebugBuild) { $tanoArguments += '--debug' }
    & npm @tanoArguments
} else {
    $tanoArguments = @('run', 'tauri', '-w', '@tano/client', '--', 'android', 'dev')
    if ($Device) { $tanoArguments += $Device }
    & npm @tanoArguments
}
exit $LASTEXITCODE

$ErrorActionPreference = 'Stop'

Write-Host 'Tano - Windows desktop prerequisites'
foreach ($command in @('node', 'npm', 'rustc', 'cargo')) {
    $resolved = Get-Command $command -ErrorAction SilentlyContinue
    if (-not $resolved) { throw "Missing $command. See README.md for setup instructions." }
    Write-Host "$command : $($resolved.Source)"
}

& node (Join-Path $PSScriptRoot 'check-node.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$tanoVsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $tanoVsWhere)) {
    throw 'Visual Studio Installer was not found. Install Visual Studio Build Tools with Desktop development with C++.'
}
$tanoVcInstall = & $tanoVsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $tanoVcInstall) {
    throw 'Visual C++ tools are missing. In Visual Studio Installer, modify the installed edition and add Desktop development with C++ plus Windows SDK.'
}
Write-Host "Visual C++ : $tanoVcInstall"
$tanoSdkLib = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Lib'
if (-not (Test-Path -LiteralPath $tanoSdkLib)) { throw 'Windows SDK libraries are missing. Add a Windows 10/11 SDK in Visual Studio Installer.' }
Write-Host "Windows SDK : $tanoSdkLib"
Write-Host 'Toolchain prerequisites found. Run npm run desktop to compile and launch Tano.'

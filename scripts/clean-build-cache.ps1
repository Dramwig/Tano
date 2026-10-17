#requires -Version 7.0
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This cleanup command requires Windows and its Recycle Bin.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gitRoot = & git -C $repoRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($gitRoot) -ne $repoRoot) {
    throw 'The script must live in scripts/ at the Git repository root.'
}

function Assert-NoBuild {
    $builders = @(Get-Process -Name cargo,rustc,rustup,gradle,java,javac -ErrorAction SilentlyContinue)
    if ($builders.Count) {
        throw "Build processes are running; retry after they exit: $($builders.ProcessName -join ', ')"
    }
}

function Assert-LocalDirectory([string]$Path) {
    $relative = [IO.Path]::GetRelativePath($repoRoot, [IO.Path]::GetFullPath($Path))
    if ($relative -eq '.' -or $relative -eq '..' -or $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar) -or [IO.Path]::IsPathRooted($relative)) {
        throw "Outside the allowed repository scope: $Path"
    }
    $part = $repoRoot
    foreach ($component in ($relative -split '[/\\]')) {
        $part = Join-Path $part $component
        if (!(Test-Path -LiteralPath $part)) { return $false }
        $item = Get-Item -LiteralPath $part -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Not an ordinary local directory: $part"
        }
    }
    return $true
}

function Recycle-CacheContents([string]$Path) {
    if (!(Assert-LocalDirectory $Path)) { return }
    foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force)) {
        if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Cache changed during cleanup; found a link: $($child.FullName)"
        }
        try {
            if ($child.PSIsContainer) {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                    $child.FullName,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
                    [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
                )
            } else {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                    $child.FullName,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
                    [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
                )
            }
        } catch {
            if ($child.PSIsContainer) { Recycle-CacheContents $child.FullName }
            else { Write-Warning "Could not recycle $($child.FullName): $($_.Exception.Message)" }
        }
    }
}

Assert-NoBuild
$targetRoots = @(
    'apps/client/src-tauri/target',
    'crates/tano-native/target',
    'packages/rust-protocol/target',
    'artifacts/windows-build-target',
    'artifacts/cargo-native-check'
)
$candidates = [Collections.Generic.List[string]]::new()
foreach ($target in $targetRoots) {
    $targetPath = Join-Path $repoRoot $target
    if (!(Assert-LocalDirectory $targetPath)) { continue }
    # Cargo profiles may be directly under target/ or under a target triple.
    $profileParents = @($targetPath) + @(Get-ChildItem -LiteralPath $targetPath -Directory -Force |
        Where-Object { $_.Name -notin @('debug', 'release') } |
        Select-Object -ExpandProperty FullName)
    foreach ($parent in $profileParents) {
        if (!(Assert-LocalDirectory $parent)) { continue }
        foreach ($buildProfile in @('debug', 'release')) {
            foreach ($cache in @('incremental', 'deps', 'build', '.fingerprint')) {
                $candidate = Join-Path $parent "$buildProfile/$cache"
                if (Assert-LocalDirectory $candidate) { $candidates.Add($candidate) }
            }
        }
    }
}
$androidCache = Join-Path $repoRoot 'apps/client/src-tauri/gen/android/app/build/intermediates'
if (Assert-LocalDirectory $androidCache) { $candidates.Add($androidCache) }

$tracked = @(& git -C $repoRoot -c core.quotePath=false ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect tracked files.' }
$inventory = @(
    foreach ($candidate in ($candidates | Sort-Object -Unique)) {
        $relative = [IO.Path]::GetRelativePath($repoRoot, $candidate).Replace('\', '/')
        if (@($tracked | Where-Object { $_ -eq $relative -or $_.StartsWith($relative + '/', [StringComparison]::OrdinalIgnoreCase) }).Count) {
            throw "Refusing to clean Git-tracked content: $relative"
        }
        # PowerShell does not traverse directory links without FollowSymlink.
        $children = @(Get-ChildItem -LiteralPath $candidate -Recurse -Force)
        if (@($children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
            throw "Refusing to clean a directory containing links: $relative"
        }
        $files = @($children | Where-Object { !$_.PSIsContainer })
        if (!$files.Count) { continue }
        [pscustomobject]@{
            Path = $candidate
            RelativePath = $relative
            Bytes = [long](($files | Measure-Object Length -Sum).Sum)
            Files = $files.Count
        }
    }
)

# Validate every candidate before performing any mutation. Never delete a whole
# target/, artifacts/, dependency directory, installer bundle or workspace.
$totalBytes = [long](($inventory | Measure-Object Bytes -Sum).Sum)
$recycledBytes = 0L
$recycledCount = 0
$failures = [Collections.Generic.List[string]]::new()
$inventory | Select-Object RelativePath,Files,@{Name='GiB';Expression={[math]::Round($_.Bytes / 1GB, 3)}} | Format-Table -AutoSize
if ($Apply) {
    Assert-NoBuild
    Add-Type -AssemblyName Microsoft.VisualBasic.Core
    foreach ($entry in $inventory) {
        Assert-NoBuild
        if (!(Assert-LocalDirectory $entry.Path)) { throw "Cache changed during cleanup: $($entry.Path)" }
        try {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                $entry.Path,
                [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
                [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
            )
            if (Test-Path -LiteralPath $entry.Path) { throw "Cache still exists: $($entry.Path)" }
            $recycledBytes += $entry.Bytes
            $recycledCount++
        } catch {
            # Windows directory watchers can prevent moving the cache container
            # while still allowing its contents to be recycled. Keep that empty
            # container instead of changing permissions or stopping processes.
            Write-Output "Recycling contents of $($entry.RelativePath); its container could not be moved."
            Recycle-CacheContents $entry.Path
            $remainingFiles = @(Get-ChildItem -LiteralPath $entry.Path -Recurse -File -Force)
            $remainingBytes = [long](($remainingFiles | Measure-Object Length -Sum).Sum)
            $recycledBytes += [math]::Max([long]0, [long]($entry.Bytes - $remainingBytes))
            if ($remainingFiles.Count) { $failures.Add($entry.RelativePath) }
            else { $recycledCount++ }
        }
    }
}
[pscustomobject]@{
    Mode = $(if ($Apply) { 'Recycled' } else { 'Preview' })
    Directories = $(if ($Apply) { $recycledCount } else { $inventory.Count })
    Bytes = $(if ($Apply) { $recycledBytes } else { $totalBytes })
    GiB = [math]::Round($(if ($Apply) { $recycledBytes } else { $totalBytes }) / 1GB, 3)
    FailedDirectories = @($failures.ToArray())
} | ConvertTo-Json -Compress
if (!$Apply) { Write-Output 'Preview only. Run npm run cache:clean -- -Apply to send these directories to the Recycle Bin.' }
else { Write-Output 'Caches moved to the Recycle Bin. Disk space is reclaimed only when those recycled items are permanently removed.' }
if ($failures.Count) { throw 'Some cache directories could not be recycled. Review the reported paths and retry after resolving the file access issue.' }

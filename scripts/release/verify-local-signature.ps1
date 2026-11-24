param([Parameter(Mandatory)][string]$Path, [string]$Thumbprint, [switch]$AllowUnsignedPreview)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($AllowUnsignedPreview) {
    if ($signature.Status -ne 'NotSigned') { throw "Expected an explicitly unsigned preview: $Path ($($signature.Status))" }
    Write-Output "Verified unsigned preview status: $([System.IO.Path]::GetFileName($Path))"
    exit 0
}
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint -or -not $signature.TimeStamperCertificate) {
    throw "Expected a valid timestamped Authenticode signature from the configured publisher: $Path ($($signature.Status))"
}
Write-Output "Verified publisher signature: $([System.IO.Path]::GetFileName($Path))"

# Download and install Portable Git to C:\devtools\git (no admin rights needed)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (Test-Path 'C:\devtools\git\cmd\git.exe') {
    Write-Host 'Git already installed:'
    & 'C:\devtools\git\cmd\git.exe' --version
    exit 0
}

$base = 'https://registry.npmmirror.com/-/binary/git-for-windows/'
$entries = Invoke-RestMethod $base

$latest = $entries | Where-Object { $_.type -eq 'dir' -and $_.name -match '^v(\d+)\.(\d+)\.(\d+)' -and $_.name -notmatch 'rc|beta|preview' } | ForEach-Object {
    $_ | Add-Member -NotePropertyName Major -NotePropertyValue ([int]$Matches[1]) -PassThru |
        Add-Member -NotePropertyName Minor -NotePropertyValue ([int]$Matches[2]) -PassThru |
        Add-Member -NotePropertyName Patch -NotePropertyValue ([int]$Matches[3]) -PassThru
} | Sort-Object Major, Minor, Patch -Descending | Select-Object -First 1

if (-not $latest) { throw 'Failed to find any git-for-windows version' }
Write-Host "Latest version: $($latest.name)"

$files = Invoke-RestMethod ($base + $latest.name)
$asset = $files | Where-Object { $_.name -match '^PortableGit-.*-64-bit\.7z\.exe$' } | Select-Object -First 1
if (-not $asset) { throw 'PortableGit 64-bit asset not found in ' + $latest.name }
Write-Host "Asset: $($asset.name)"

$tmp = Join-Path $env:TEMP $asset.name
Write-Host 'Downloading...'
Invoke-WebRequest $asset.url -OutFile $tmp

New-Item -ItemType Directory -Force -Path 'C:\devtools\git' | Out-Null
Write-Host 'Extracting to C:\devtools\git ...'
$proc = Start-Process -FilePath $tmp -ArgumentList '-oC:\devtools\git', '-y' -Wait -PassThru
if ($proc.ExitCode -ne 0) { throw "Self-extractor exited with code $($proc.ExitCode)" }
Remove-Item $tmp -Force

& 'C:\devtools\git\cmd\git.exe' --version

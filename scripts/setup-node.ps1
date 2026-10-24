# Download and install portable Node.js LTS to C:\devtools\node (no admin rights needed)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$dest = 'C:\devtools'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

if (Test-Path "$dest\node\node.exe") {
    Write-Host "Node already installed:"
    & "$dest\node\node.exe" --version
    exit 0
}

$idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$v = ($idx | Where-Object { $_.lts } | Select-Object -First 1).version
Write-Host "Latest LTS: $v"

$url = "https://nodejs.org/dist/$v/node-$v-win-x64.zip"
$zip = "$env:TEMP\node-$v-win-x64.zip"
Write-Host "Downloading $url ..."
Invoke-WebRequest -Uri $url -OutFile $zip

Write-Host "Extracting to $dest ..."
Expand-Archive -Path $zip -DestinationPath $dest -Force
if (Test-Path "$dest\node") { Remove-Item "$dest\node" -Recurse -Force }
Rename-Item "$dest\node-$v-win-x64" "$dest\node"
Remove-Item $zip -Force

Write-Host "Installed:"
& "$dest\node\node.exe" --version
& "$dest\node\npm.cmd" --version

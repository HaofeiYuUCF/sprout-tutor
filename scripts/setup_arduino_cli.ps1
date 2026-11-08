# Download a pinned arduino-cli into tools/ and install the AVR core into a repo-local data dir.
# Usage (from the repository root, in PowerShell):  .\scripts\setup_arduino_cli.ps1
param(
    [string]$Version = "1.1.1",
    [string]$AvrCore = "arduino:avr@1.8.6"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root "tools\arduino-cli"
New-Item -ItemType Directory -Force $Tools | Out-Null

$Zip = Join-Path $Tools "arduino-cli.zip"
$Url = "https://github.com/arduino/arduino-cli/releases/download/v$Version/arduino-cli_${Version}_Windows_64bit.zip"
Write-Host "Downloading arduino-cli $Version from $Url"
Invoke-WebRequest -Uri $Url -OutFile $Zip
Expand-Archive -Path $Zip -DestinationPath $Tools -Force
Remove-Item $Zip
Get-ChildItem $Tools -Recurse | Unblock-File   # avoid SmartScreen blocking the downloaded exe

# Write a git-ignored config with absolute, repo-local directories.
$Cfg = Join-Path $Root "tools\arduino-cli.yaml"
$Data = (Join-Path $Root "tools\arduino-data") -replace '\\','/'
$User = (Join-Path $Root "tools\arduino-user") -replace '\\','/'
@"
directories:
  data: $Data
  downloads: $Data/staging
  user: $User
board_manager:
  additional_urls: []
"@ | Set-Content -Encoding utf8 $Cfg

$Cli = Join-Path $Tools "arduino-cli.exe"
& $Cli --config-file $Cfg core update-index
& $Cli --config-file $Cfg core install $AvrCore

$Libs = Get-Content (Join-Path $Root "config\arduino-libs.txt") | Where-Object { $_ -and -not $_.StartsWith("#") }
foreach ($lib in $Libs) { & $Cli --config-file $Cfg lib install $lib }

& $Cli version
Write-Host "Done. Run:  .venv\Scripts\sprout doctor"

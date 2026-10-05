$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Web/server build failed.' }
& (Join-Path $PSScriptRoot 'build-native.ps1')

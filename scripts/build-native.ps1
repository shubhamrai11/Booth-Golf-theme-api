$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location (Split-Path $PSScriptRoot)
try {
  & $compiler /nologo /platform:x64 /target:exe /r:System.Windows.Forms.dll /out:native\CanonCapture.exe native\CanonCapture.cs
  if ($LASTEXITCODE -ne 0) { throw 'Canon bridge build failed.' }
  & $compiler /nologo /platform:x64 /target:exe /r:System.Drawing.dll /r:System.Web.Extensions.dll /out:native\PrintPhoto.exe native\PrintPhoto.cs
  if ($LASTEXITCODE -ne 0) { throw 'Print bridge build failed.' }
  & $compiler /nologo /platform:x64 /target:winexe /r:System.Windows.Forms.dll '/out:Fairway Studio.exe' native\Launcher.cs
  if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
  & $compiler /nologo /platform:x64 /target:winexe /r:System.Windows.Forms.dll '/out:Fairway Cloud Helper.exe' native\CloudHelperLauncher.cs
  if ($LASTEXITCODE -ne 0) { throw 'Cloud helper launcher build failed.' }
} finally { Pop-Location }

[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "assets\voice\manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$runtimeRoot = Join-Path $projectRoot ".agent\runtime\voice"
$downloadRoot = Join-Path $projectRoot ".agent\downloads"
$engineRoot = Join-Path $runtimeRoot ("whisper.cpp-" + $manifest.whisperCpp.version)
$modelRoot = Join-Path $runtimeRoot "models"
$archivePath = Join-Path $downloadRoot "whisper-bin-x64.zip"
$model = $manifest.sttModels | Where-Object id -eq "whisper-base-multilingual"
$modelPath = Join-Path $modelRoot $model.fileName
$ttsModel = $manifest.ttsModels | Where-Object id -eq "supertonic-3-int8"
$ttsArchivePath = Join-Path $downloadRoot ($ttsModel.directoryName + ".tar.bz2")
$ttsModelRoot = Join-Path $runtimeRoot $ttsModel.directoryName

New-Item -ItemType Directory -Force -Path $runtimeRoot, $downloadRoot, $modelRoot |
  Out-Null

function Get-VerifiedArtifact {
  param(
    [Parameter(Mandatory)]
    [string]$Url,
    [Parameter(Mandatory)]
    [string]$Destination,
    [Parameter(Mandatory)]
    [string]$ExpectedSha256
  )

  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($existingHash -ieq $ExpectedSha256) {
      Write-Host ("Verified cached artifact: " + $Destination)
      return
    }
  }

  $temporaryPath = $Destination + ".partial"
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }

  Write-Host ("Downloading " + $Url)
  Invoke-WebRequest -Uri $Url -OutFile $temporaryPath -UseBasicParsing
  $actualHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash
  if ($actualHash -ine $ExpectedSha256) {
    Remove-Item -LiteralPath $temporaryPath -Force
    throw (
      "SHA-256 mismatch for " + $Url +
      ". Expected " + $ExpectedSha256 + " but received " + $actualHash + "."
    )
  }
  Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force
  Write-Host ("Verified SHA-256: " + $actualHash.ToLowerInvariant())
}

Get-VerifiedArtifact -Url $manifest.whisperCpp.archive.url -Destination $archivePath -ExpectedSha256 $manifest.whisperCpp.archive.sha256
Get-VerifiedArtifact -Url $model.url -Destination $modelPath -ExpectedSha256 $model.sha256
Get-VerifiedArtifact -Url $ttsModel.url -Destination $ttsArchivePath -ExpectedSha256 $ttsModel.sha256

$cli = Get-ChildItem -LiteralPath $engineRoot -Filter "whisper-cli.exe" -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $cli -or $Force) {
  $temporaryInstall = Join-Path $runtimeRoot (
    ".install-" + [Guid]::NewGuid().ToString("N")
  )
  New-Item -ItemType Directory -Path $temporaryInstall | Out-Null
  try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryInstall
    $extractedCli = Get-ChildItem -LiteralPath $temporaryInstall -Filter "whisper-cli.exe" -Recurse |
      Select-Object -First 1
    if (-not $extractedCli) {
      throw "The verified whisper.cpp archive did not contain whisper-cli.exe."
    }
    if (Test-Path -LiteralPath $engineRoot) {
      Remove-Item -LiteralPath $engineRoot -Recurse -Force
    }
    Move-Item -LiteralPath $temporaryInstall -Destination $engineRoot
  }
  catch {
    if (Test-Path -LiteralPath $temporaryInstall) {
      Remove-Item -LiteralPath $temporaryInstall -Recurse -Force
    }
    throw
  }
}

$cli = Get-ChildItem -LiteralPath $engineRoot -Filter "whisper-cli.exe" -Recurse |
  Select-Object -First 1

$ttsConfigPath = Join-Path $ttsModelRoot "tts.json"
if (-not (Test-Path -LiteralPath $ttsConfigPath) -or $Force) {
  $temporaryTtsInstall = Join-Path $runtimeRoot (
    ".tts-install-" + [Guid]::NewGuid().ToString("N")
  )
  New-Item -ItemType Directory -Path $temporaryTtsInstall | Out-Null
  try {
    & tar.exe -xjf $ttsArchivePath -C $temporaryTtsInstall
    if ($LASTEXITCODE -ne 0) {
      throw "tar.exe failed while extracting the verified Supertonic archive."
    }
    $extractedConfig = Get-ChildItem -LiteralPath $temporaryTtsInstall -Filter "tts.json" -Recurse |
      Select-Object -First 1
    if (-not $extractedConfig) {
      throw "The verified Supertonic archive did not contain tts.json."
    }
    $extractedRoot = $extractedConfig.Directory.FullName
    if (Test-Path -LiteralPath $ttsModelRoot) {
      Remove-Item -LiteralPath $ttsModelRoot -Recurse -Force
    }
    Move-Item -LiteralPath $extractedRoot -Destination $ttsModelRoot
  }
  finally {
    if (Test-Path -LiteralPath $temporaryTtsInstall) {
      Remove-Item -LiteralPath $temporaryTtsInstall -Recurse -Force
    }
  }
}

[pscustomobject]@{
  EngineVersion = $manifest.whisperCpp.version
  EngineCommit = $manifest.whisperCpp.commit
  EnginePath = $cli.FullName
  ModelId = $model.id
  ModelPath = $modelPath
  ModelSha256 = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
  TtsRuntime = $manifest.ttsRuntime.id + "@" + $manifest.ttsRuntime.version
  TtsModelId = $ttsModel.id
  TtsModelPath = $ttsModelRoot
  TtsArchiveSha256 = (Get-FileHash -LiteralPath $ttsArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
} | Format-List

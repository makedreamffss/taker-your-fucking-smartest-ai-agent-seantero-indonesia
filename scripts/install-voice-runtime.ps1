[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "assets\voice\manifest.json"
$requirementsPath = Join-Path $projectRoot "assets\voice\requirements-pocket-tts.lock"
$prewarmPath = Join-Path $PSScriptRoot "prewarm-pocket-tts.py"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$runtimeRoot = Join-Path $projectRoot ".agent\runtime\voice"
$downloadRoot = Join-Path $projectRoot ".agent\downloads"
$engineRoot = Join-Path $runtimeRoot ("whisper.cpp-" + $manifest.whisperCpp.version)
$modelRoot = Join-Path $runtimeRoot "models"
$archivePath = Join-Path $downloadRoot "whisper-bin-x64.zip"
$model = $manifest.sttModels | Where-Object id -eq "whisper-base-multilingual"
$modelPath = Join-Path $modelRoot $model.fileName
$ttsModel = $manifest.ttsModels | Where-Object id -eq "pocket-tts-english-standard"
$ttsVoice = $manifest.ttsVoices | Where-Object id -eq "peter_yearsley"
$ttsRuntimeRoot = Join-Path $runtimeRoot ("pocket-tts-" + $manifest.ttsRuntime.version)
$ttsPython = Join-Path $ttsRuntimeRoot "Scripts\python.exe"
$ttsCacheRoot = Join-Path $runtimeRoot "huggingface"

New-Item -ItemType Directory -Force -Path $runtimeRoot, $downloadRoot, $modelRoot, $ttsCacheRoot |
  Out-Null

function Assert-ChildPath {
  param(
    [Parameter(Mandatory)]
    [string]$Parent,
    [Parameter(Mandatory)]
    [string]$Candidate
  )

  $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $candidatePath = [IO.Path]::GetFullPath($Candidate)
  $prefix = $parentPath + [IO.Path]::DirectorySeparatorChar
  if (-not $candidatePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the voice runtime: $candidatePath"
  }
}

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
  Assert-ChildPath -Parent $projectRoot -Candidate $temporaryPath
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

$cli = Get-ChildItem -LiteralPath $engineRoot -Filter "whisper-cli.exe" -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $cli -or $Force) {
  $temporaryInstall = Join-Path $runtimeRoot (".install-" + [Guid]::NewGuid().ToString("N"))
  Assert-ChildPath -Parent $runtimeRoot -Candidate $temporaryInstall
  New-Item -ItemType Directory -Path $temporaryInstall | Out-Null
  try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryInstall
    $extractedCli = Get-ChildItem -LiteralPath $temporaryInstall -Filter "whisper-cli.exe" -Recurse |
      Select-Object -First 1
    if (-not $extractedCli) {
      throw "The verified whisper.cpp archive did not contain whisper-cli.exe."
    }
    if (Test-Path -LiteralPath $engineRoot) {
      Assert-ChildPath -Parent $runtimeRoot -Candidate $engineRoot
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

if ($Force -and (Test-Path -LiteralPath $ttsRuntimeRoot)) {
  Assert-ChildPath -Parent $runtimeRoot -Candidate $ttsRuntimeRoot
  Remove-Item -LiteralPath $ttsRuntimeRoot -Recurse -Force
}

if (-not (Test-Path -LiteralPath $ttsPython)) {
  $pythonLauncher = (Get-Command py.exe -ErrorAction Stop).Source
  & $pythonLauncher ("-" + $manifest.ttsRuntime.python) -m venv $ttsRuntimeRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ttsPython)) {
    throw "Python $($manifest.ttsRuntime.python) failed to create the Pocket TTS environment."
  }
}

& $ttsPython -m pip install --disable-pip-version-check --requirement $requirementsPath
if ($LASTEXITCODE -ne 0) {
  throw "The exact-pinned Pocket TTS dependency installation failed."
}

$previousHfHome = $env:HF_HOME
$previousSymlinkWarning = $env:HF_HUB_DISABLE_SYMLINKS_WARNING
try {
  $env:HF_HOME = $ttsCacheRoot
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
  & $ttsPython $prewarmPath --language "english" --voice $ttsVoice.id
  if ($LASTEXITCODE -ne 0) {
    throw "Pocket TTS model and voice prewarm failed."
  }
}
finally {
  $env:HF_HOME = $previousHfHome
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = $previousSymlinkWarning
}

[pscustomobject]@{
  EngineVersion = $manifest.whisperCpp.version
  EngineCommit = $manifest.whisperCpp.commit
  EnginePath = $cli.FullName
  ModelId = $model.id
  ModelPath = $modelPath
  ModelSha256 = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
  TtsRuntime = $manifest.ttsRuntime.id + "@" + $manifest.ttsRuntime.version
  TtsPython = $ttsPython
  TtsModelId = $ttsModel.id
  TtsModelRevision = $ttsModel.revision
  TtsVoice = $ttsVoice.id
  TtsVoiceSourceLicense = $ttsVoice.sourceLicense
  TtsCache = $ttsCacheRoot
} | Format-List

param(
  [string]$InputDirectory = ".agent\diagnostics\embodiment-actions-v3",
  [string]$OutputPath = ".agent\diagnostics\embodiment-actions-v3\contact-sheet.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$files = @(Get-ChildItem -LiteralPath $InputDirectory -Filter "*.png" |
  Where-Object { $_.Name -ne "contact-sheet.png" } |
  Sort-Object Name)
if ($files.Count -ne 16) {
  throw "Expected exactly 16 action captures; found $($files.Count)."
}

$columns = 4
$rows = 4
$tileWidth = 200
$imageHeight = 275
$labelHeight = 28
$sheet = New-Object System.Drawing.Bitmap ($columns * $tileWidth), ($rows * ($imageHeight + $labelHeight))
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 7, 10, 12))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 210, 228, 233))

try {
  for ($index = 0; $index -lt $files.Count; $index += 1) {
    $column = $index % $columns
    $row = [Math]::Floor($index / $columns)
    $x = $column * $tileWidth
    $y = $row * ($imageHeight + $labelHeight)
    $image = [System.Drawing.Image]::FromFile($files[$index].FullName)
    try {
      $graphics.DrawImage($image, $x, $y, $tileWidth, $imageHeight)
    } finally {
      $image.Dispose()
    }
    $label = [IO.Path]::GetFileNameWithoutExtension($files[$index].Name) -replace '^\d+-', ''
    $graphics.DrawString($label, $font, $brush, $x + 8, $y + $imageHeight + 6)
  }
  $resolvedOutput = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
  $sheet.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $resolvedOutput
} finally {
  $brush.Dispose()
  $font.Dispose()
  $graphics.Dispose()
  $sheet.Dispose()
}

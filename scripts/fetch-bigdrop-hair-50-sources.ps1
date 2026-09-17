param(
  [string]$ManifestPath = '',
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) { $ManifestPath = Join-Path $workspace 'outputs\bigdrop-hair-50-new-2026-09-09\bigdrop-hair-50-manifest.json' }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $workspace 'outputs\bigdrop-hair-50-new-2026-09-09\sources' }
$items = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$report = @()
$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'; 'Accept-Language' = 'uk-UA,uk;q=0.9' }

foreach ($item in $items) {
  $dir = Join-Path $OutputRoot ('{0:D3}_{1}' -f [int]$item.index, ($item.code -replace '[^A-Za-z0-9_-]', '_'))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $saved = @()
  $errors = @()
  try {
    $page = Invoke-WebRequest -UseBasicParsing -Uri $item.url -Headers $headers -TimeoutSec 45
    $html = [string]$page.Content
    $encoded = [regex]::Matches($html, '(?:https?:)?\\?/\\?/images\.prom\.ua\\?/[A-Za-z0-9_./%?=&-]+\.(?:jpg|jpeg|png|webp)') | ForEach-Object { $_.Value -replace '\\/', '/' }
    $urls = $encoded | ForEach-Object { if ($_ -notmatch '^https?://') { 'https:' + $_ } else { $_ } } | ForEach-Object { $_ -replace '&amp;', '&' } | Select-Object -Unique
    $urls = @($urls | Where-Object { $_ -notmatch 'w159_h159|w100_h100|tracking|sprite' })
    if ($urls.Count -lt 3) {
      $urls = @($encoded | ForEach-Object { if ($_ -notmatch '^https?://') { 'https:' + $_ } else { $_ } } | ForEach-Object { $_ -replace '&amp;', '&' } | Select-Object -Unique | Where-Object { $_ -notmatch 'tracking|sprite' })
    }
    $urls = @($urls | Select-Object -First 5)
    $n = 0
    foreach ($u in $urls) {
      $n++
      $ext = [IO.Path]::GetExtension(([uri]$u).AbsolutePath)
      if ([string]::IsNullOrWhiteSpace($ext)) { $ext = '.jpg' }
      $out = Join-Path $dir ('source-{0:D2}{1}' -f $n, $ext.ToLowerInvariant())
      try {
        Invoke-WebRequest -UseBasicParsing -Uri $u -Headers $headers -TimeoutSec 45 -OutFile $out
        if ((Get-Item -LiteralPath $out).Length -gt 5000) { $saved += $out } else { Remove-Item -LiteralPath $out -Force; $errors += "Empty image: $u" }
      } catch { $errors += "Download failed $u : $($_.Exception.Message)" }
    }
  } catch { $errors += "Page open failed $($item.url) : $($_.Exception.Message)" }
  $report += [pscustomobject]@{ index=$item.index; code=$item.code; url=$item.url; saved=$saved; errors=$errors }
  Write-Output ("[{0}/50] {1} -> {2} images" -f $item.index, $item.code, $saved.Count)
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $OutputRoot 'source-fetch-report.json')

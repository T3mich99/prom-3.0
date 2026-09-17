param(
  [Parameter(Mandatory=$true)]
  [string]$InputDir
)

Add-Type -AssemblyName System.Drawing

Get-ChildItem -LiteralPath $InputDir -Recurse -File -Include *.png,*.jpg,*.jpeg | ForEach-Object {
  $src = $_.FullName
  $tmp = "$src.__tmp.png"
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    $bmp = New-Object System.Drawing.Bitmap 1280,1280
    try {
      $bmp.SetResolution(96,96)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::White)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($img, 0, 0, 1280, 1280)
      } finally { $g.Dispose() }
      $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
  Move-Item -LiteralPath $tmp -Destination $src -Force
}

Get-ChildItem -LiteralPath $InputDir -Recurse -File -Filter *.png | ForEach-Object {
  $check = [System.Drawing.Image]::FromFile($_.FullName)
  try { "$($_.FullName)`t$($check.Width)x$($check.Height)" } finally { $check.Dispose() }
}

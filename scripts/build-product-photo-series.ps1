param(
  [Parameter(Mandatory=$true)] [string]$SourceDataDir,
  [Parameter(Mandatory=$true)] [string]$SourceImageDir,
  [Parameter(Mandatory=$true)] [string]$OutputDir
)

throw 'Legacy product-photo generator disabled. Use PHOTO-MASTER-SPEC.md as the only active photo-generation specification.'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Common -ErrorAction SilentlyContinue

function FitRect([int]$srcW, [int]$srcH, [int]$x, [int]$y, [int]$w, [int]$h, [bool]$cover) {
  $scale = if($cover){ [Math]::Max($w/$srcW, $h/$srcH) } else { [Math]::Min($w/$srcW, $h/$srcH) }
  $dw=[int]($srcW*$scale); $dh=[int]($srcH*$scale)
  return New-Object System.Drawing.Rectangle([int]($x+($w-$dw)/2),[int]($y+($h-$dh)/2),$dw,$dh)
}

function DrawImageFit($g, $img, [int]$x, [int]$y, [int]$w, [int]$h, [bool]$cover) {
  $r=FitRect $img.Width $img.Height $x $y $w $h $cover
  $g.DrawImage($img,$r)
}

function Text($g, [string]$value, [float]$size, [int]$x, [int]$y, [int]$w, [System.Drawing.Color]$color, [bool]$bold=$false) {
  $font=New-Object System.Drawing.Font('Segoe UI',$size,($(if($bold){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular})),[System.Drawing.GraphicsUnit]::Pixel)
  try { $brush=New-Object System.Drawing.SolidBrush($color); try { $g.DrawString($value,$font,$brush,(New-Object System.Drawing.RectangleF($x,$y,$w,220))) } finally {$brush.Dispose()} } finally {$font.Dispose()}
}

function ShortTitle($p) {
  $c=[string]$p.breadcrumbs[-2]
  if([string]::IsNullOrWhiteSpace($c)){ $c='Товар для дому' }
  return $c.ToUpper()
}

function Benefits($p) {
  $c=(([string]$p.name)+' '+[string]$p.breadcrumbs[-2]).ToLower()
  if($c -match 'дощовик'){ return @('Захист від дощу','Легкий матеріал','Зручно брати із собою') }
  if($c -match 'сушарка.*білиз|білиз.*сушар'){ return @('Зручне використання','Компактне зберігання','Для дому') }
  if($c -match 'сушарка.*взут'){ return @('Швидке сушіння','Компактний формат','Для щоденного використання') }
  if($c -match 'посуд|раковин|кухон'){ return @('Порядок на кухні','Зручний доступ','Легко підтримувати чистоту') }
  if($c -match 'ванн|мочал|щіт'){ return @('Зручно у використанні','Практична форма','Для дому') }
  if($c -match 'помп|вода'){ return @('Зручна подача води','Просте керування','Для щоденного використання') }
  if($c -match 'стрічк|скотч|клей'){ return @('Надійне кріплення','Зручний формат','Практичне рішення') }
  if($c -match 'двер|ручк'){ return @('Просте встановлення','Зручний захист','Для дому') }
  return @('Практичне рішення','Зручне використання','Для дому та щоденних справ')
}

function UseLine($p) {
  $c=(([string]$p.name)+' '+[string]$p.breadcrumbs[-2]).ToLower()
  if($c -match 'авто|автомоб|сидін'){ return 'Для поїздок та щоденного комфорту' }
  if($c -match 'кух|посуд|раковин'){ return 'Для зручного використання на кухні' }
  if($c -match 'ванн|щіт|мочал'){ return 'Для чистоти та порядку вдома' }
  if($c -match 'білиз|взут'){ return 'Зручно для домашнього використання' }
  return 'Практично для щоденних справ'
}

function FeatureLines($p) {
  $vals=@()
  foreach($ch in @($p.chars)){
    $n=[string]$ch.name; $v=[string]$ch.value
    if($n -match 'модель|sku|артикул|код|бренд|виробник|постачальник'){ continue }
    if([string]::IsNullOrWhiteSpace($v)){ continue }
    $s="$n — $v"
    if($s.Length -gt 44){ $s=$s.Substring(0,44).TrimEnd() }
    $vals += $s
    if($vals.Count -ge 5){ break }
  }
  if($vals.Count -eq 0){ $vals=@('Практичний дизайн','Зручний формат','Для щоденного використання') }
  return $vals
}

function NewSeriesImage($p, [string]$role, [string]$srcPath, [string]$destPath) {
  $bmp=New-Object System.Drawing.Bitmap(1280,1280)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $img=[System.Drawing.Image]::FromFile($srcPath)
  try {
    $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $navy=[System.Drawing.Color]::FromArgb(19,55,91); $blue=[System.Drawing.Color]::FromArgb(34,101,171); $gold=[System.Drawing.Color]::FromArgb(178,124,40)
    $ink=[System.Drawing.Color]::FromArgb(29,39,52); $muted=[System.Drawing.Color]::FromArgb(235,240,245)
    if($role -eq '01_main'){
      $g.Clear([System.Drawing.Color]::White); $g.FillRectangle((New-Object System.Drawing.SolidBrush($muted)),0,0,1280,150)
      Text $g (ShortTitle $p) 48 55 38 1120 $navy $true
      Text $g 'Практичний вибір для дому' 28 58 102 900 $ink $false
      DrawImageFit $g $img 80 180 1120 1000 $false
    } elseif($role -eq '02_benefits'){
      $g.Clear([System.Drawing.Color]::FromArgb(247,249,251)); $g.FillRectangle((New-Object System.Drawing.SolidBrush($navy)),0,0,430,1280)
      Text $g 'КЛЮЧОВІ' 42 42 60 350 ([System.Drawing.Color]::White) $true; Text $g 'ПЕРЕВАГИ' 42 42 110 350 ([System.Drawing.Color]::White) $true
      $y=260; foreach($b in (Benefits $p)){ $g.FillEllipse((New-Object System.Drawing.SolidBrush($gold)),55,$y,42,42); Text $g '✓' 28 64 ($y+4) 30 ([System.Drawing.Color]::White) $true; Text $g $b 25 120 ($y-5) 275 $ink $true; $y+=150 }
      DrawImageFit $g $img 450 150 780 980 $true
    } elseif($role -eq '03_features'){
      $g.Clear([System.Drawing.Color]::White); Text $g 'ХАРАКТЕРИСТИКИ' 48 50 45 1120 $navy $true
      DrawImageFit $g $img 40 190 680 940 $false
      $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(246,248,250))),760,180,470,960)
      $y=250; foreach($f in (FeatureLines $p)){ $g.FillEllipse((New-Object System.Drawing.SolidBrush($blue)),795,$y,24,24); Text $g $f 24 840 ($y-10) 340 $ink $false; $y+=145 }
    } elseif($role -eq '04_use'){
      $g.Clear([System.Drawing.Color]::FromArgb(245,241,232)); Text $g 'ЗРУЧНО ЩОДНЯ' 48 55 55 1120 $navy $true; Text $g (UseLine $p) 28 58 125 1050 $ink $false; DrawImageFit $g $img 65 210 1150 970 $true
    } else {
      $g.Clear([System.Drawing.Color]::FromArgb(35,42,52)); Text $g 'ДЕТАЛІ' 48 55 55 1120 ([System.Drawing.Color]::White) $true
      DrawImageFit $g $img 80 190 1120 960 $true
    }
    $bmp.Save($destPath,[System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $img.Dispose(); $g.Dispose(); $bmp.Dispose() }
}

$products=@(); foreach($f in (Get-ChildItem -Path $SourceDataDir -Filter 'selected-*.json' | Sort-Object Name)){ $products += @(Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json) }
$roles=@('01_main','02_benefits','03_features','04_use','05_details')
foreach($p in $products){
  $code=[string]$p.code; $dir=Join-Path $OutputDir $code; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $srcs=@(Get-ChildItem -Path $SourceImageDir -Filter ($code+'_*.jpg') | Sort-Object Name)
  if($srcs.Count -eq 0){ continue }
  foreach($i in 0..4){
    $role=$roles[$i]; $dest=Join-Path $dir ($role+'.png'); if(Test-Path -LiteralPath $dest){ continue }
    $source=$srcs[$i % $srcs.Count].FullName
    NewSeriesImage $p $role $source $dest
  }
}

Get-ChildItem -Path $OutputDir -Recurse -File -Filter '*.png' | Measure-Object | Select-Object -ExpandProperty Count

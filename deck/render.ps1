# Renders every slide of the deck to PNG via PowerPoint (visual QA).
param([string]$Out = "$PSScriptRoot\render")
$src = Join-Path $PSScriptRoot "ISA88_Knowledge_Graph_Concept.pptx"
New-Item -ItemType Directory -Force $Out | Out-Null
Get-ChildItem $Out -Filter *.png | Remove-Item -Force
$ppt = New-Object -ComObject PowerPoint.Application
$p = $ppt.Presentations.Open($src, $true, $false, $false)
$i = 1
foreach ($s in $p.Slides) { $s.Export("$Out\slide-$i.png", "PNG", 1600, 900); $i++ }
$p.Close()
$ppt.Quit()
"rendered $($i - 1) slides to $Out"

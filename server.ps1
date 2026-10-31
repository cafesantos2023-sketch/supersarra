# Serveur local minimal pour Sarra VRM (port 8642, s'arrête après 8 h)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
try{ $H=[System.Net.HttpListener]::new();$H.Prefixes.Add('http://localhost:8642/');$H.Start() }
catch{ exit 0 }   # port déjà occupé : une instance tourne déjà
$html=(Get-ChildItem $root -Filter 'Sarra*.html' | Select-Object -First 1).FullName
$vrm=(Get-ChildItem $root -Filter 'sarra7*.vrm' | Select-Object -First 1).FullName
$expire=(Get-Date).AddHours(8)
function Send($ctx,$code,$type,$bytes){
  $r=$ctx.Response;$r.StatusCode=$code;$r.ContentType=$type
  $r.Headers['Cache-Control']='no-cache';$r.ContentLength64=$bytes.Length
  $r.OutputStream.Write($bytes,0,$bytes.Length);$r.OutputStream.Close()
}
while($H.IsListening -and (Get-Date) -lt $expire){
  try{ $ctx=$H.GetContext() }catch{ break }
  try{
    $p=$ctx.Request.Url.AbsolutePath.TrimEnd('/')
    $fn=$null;$type='application/octet-stream'
    if($p -eq '' -or $p -eq '/'){$fn=$html;$type='text/html; charset=utf-8'}
    elseif($p.EndsWith('.vrm',1)){$fn=$vrm;$type='model/gltf-binary'}
    else{ $fn=Join-Path $root ($p.TrimStart('/') -replace '/','\') }
    if($fn -and (Test-Path $fn)){ Send $ctx 200 $type ([IO.File]::ReadAllBytes($fn)) }
    else{ Send $ctx 404 'text/plain' [Text.Encoding]::UTF8.GetBytes('404') }
  }catch{ try{ $ctx.Response.StatusCode=500;$ctx.Response.OutputStream.Close() }catch{} }
}
try{$H.Stop()}catch{}

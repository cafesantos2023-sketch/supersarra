$ErrorActionPreference='SilentlyContinue'
$ok=$false
for($i=0;$i -lt 12 -and -not $ok;$i++){
  Start-Sleep -Milliseconds 500
  try{ Invoke-WebRequest -UseBasicParsing 'http://localhost:8642/' -TimeoutSec 2 | Out-Null; $ok=$true }catch{}
}
if($ok){ Start-Process 'http://localhost:8642/'; Write-Host 'Application ouverte : http://localhost:8642/' }
else{ Write-Host 'Erreur serveur local : verifiez server.ps1'; exit 1 }

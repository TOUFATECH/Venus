# Venus - installation sur Windows 10 / 11 (sans Docker)
#
# Dans PowerShell :
#   irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex
# ou, depuis le dossier Venus :
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#
# Relancer le script met Venus a jour (reglages et bibliotheques conserves).
# Desinstaller :  $env:VENUS_ACTION='uninstall'; irm https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1 | iex
#
# Venus tourne en tache de fond (compte SYSTEME) des le demarrage du PC, meme sans session ouverte.
# Donnees : C:\ProgramData\Venus      Journal : C:\ProgramData\Venus\venus.log

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest est 10x plus rapide sans barre de progression
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ScriptUrl = 'https://raw.githubusercontent.com/TOUFATECH/Venus/main/scripts/install-windows.ps1'
$ZipUrl    = 'https://github.com/TOUFATECH/Venus/archive/refs/heads/main.zip'
$Root      = Join-Path $env:ProgramData 'Venus'
$AppDir    = Join-Path $Root 'app'
$DataDir   = Join-Path $Root 'data'
$Transcode = Join-Path $Root 'transcode'
$NodeDir   = Join-Path $Root 'node'
$FfDir     = Join-Path $Root 'ffmpeg'
$ConfFile  = Join-Path $Root 'venus.conf'
$Launcher  = Join-Path $Root 'venus.cmd'
$LogFile   = Join-Path $Root 'venus.log'
$TaskName  = 'Venus'

function Say($t)  { Write-Host $t -ForegroundColor White }
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Fail($t) { Write-Host "  [X]  $t" -ForegroundColor Red; throw $t }
function Ask($q, $def) {
  $v = Read-Host "  $q"
  if ([string]::IsNullOrWhiteSpace($v)) { return $def } else { return $v.Trim().Trim('"') }
}

function Stop-Venus {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*server\index.js*') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*venus.cmd*') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
}

# ---------------------------------------------------------------- droits administrateur
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Warn "Droits administrateur necessaires : Windows va vous demander l'autorisation."
  $self = $PSCommandPath
  if (-not $self) {
    $self = Join-Path $env:TEMP 'venus-install.ps1'
    $code = (Invoke-WebRequest -UseBasicParsing $ScriptUrl).Content
    [IO.File]::WriteAllText($self, $code, (New-Object Text.UTF8Encoding $true))
  }
  $cmd = "-NoProfile -ExecutionPolicy Bypass -File `"$self`""
  if ($env:VENUS_ACTION) { $cmd = "-NoProfile -ExecutionPolicy Bypass -Command `"`$env:VENUS_ACTION='$($env:VENUS_ACTION)'; & '$self'`"" }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $cmd
  return
}

# ---------------------------------------------------------------- desinstallation
if ($env:VENUS_ACTION -eq 'uninstall') {
  Say 'Desinstallation de Venus'
  Stop-Venus
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName 'Venus' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Ok 'Venus est arrete et ne demarre plus avec Windows'
  Warn "Conserves : vos videos et vos reglages ($Root). Pour tout effacer, supprimez ce dossier."
  return
}

Say 'Installation de Venus sur Windows'
New-Item -ItemType Directory -Force -Path $Root, $DataDir, $Transcode | Out-Null

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }

function Download($url, $dest) {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest
}

# ---------------------------------------------------------------- code de Venus
$fromRepo = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot '..\server\index.js'))) { $fromRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if ($fromRepo) {
  $AppDir = $fromRepo
  Ok "Code de Venus : $AppDir"
} else {
  $zip = Join-Path $env:TEMP 'venus-main.zip'
  $tmp = Join-Path $env:TEMP ('venus-' + [Guid]::NewGuid().ToString('N'))
  Download $ZipUrl $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Stop-Venus
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
  Move-Item $src.FullName $AppDir
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Code de Venus telecharge (derniere version) dans $AppDir"
}

# ---------------------------------------------------------------- Node.js (>= 22.13)
function NodeOk($exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  try { $v = (& $exe -v) -replace '^v', '' } catch { return $false }
  $p = $v.Split('.'); $a = [int]$p[0]; $b = [int]$p[1]
  return ($a -gt 22) -or ($a -eq 22 -and $b -ge 13)
}
$NodeExe = $null
$sys = Get-Command node.exe -ErrorAction SilentlyContinue
if ($sys -and (NodeOk $sys.Source) -and ($sys.Source -notlike "$env:LOCALAPPDATA*")) { $NodeExe = $sys.Source }
elseif (NodeOk (Join-Path $NodeDir 'node.exe')) { $NodeExe = Join-Path $NodeDir 'node.exe' }
else {
  # Version portable officielle de nodejs.org (aucune installation systeme)
  $base = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
  $m = [regex]::Match($sums, "([0-9a-f]{64})\s+(node-v[0-9.]+-win-$arch\.zip)")
  if (-not $m.Success) { Fail 'Telechargement de Node.js impossible (nodejs.org injoignable ?)' }
  $zip = Join-Path $env:TEMP $m.Groups[2].Value
  Download "$base/$($m.Groups[2].Value)" $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $m.Groups[1].Value) { Fail 'Somme de controle de Node.js invalide' }
  $tmp = Join-Path $env:TEMP ('node-' + [Guid]::NewGuid().ToString('N'))
  Expand-Archive $zip $tmp -Force
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $NodeDir
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  $NodeExe = Join-Path $NodeDir 'node.exe'
}
Ok "Node.js $(& $NodeExe -v)"

# ---------------------------------------------------------------- ffmpeg (NVIDIA, Intel Quick Sync, AMD inclus)
$FfExe = Join-Path $FfDir 'bin\ffmpeg.exe'
if (-not (Test-Path $FfExe)) {
  # Version stable de gyan.dev (x64), sinon BtbN sur GitHub (x64 et ARM)
  $urls = @()
  if ($arch -eq 'x64') { $urls += 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' }
  $urls += "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win$(if ($arch -eq 'arm64') { 'arm64' } else { '64' })-gpl.zip"
  Say 'Telechargement de ffmpeg (environ 100 Mo, une seule fois)...'
  $done = $false
  foreach ($u in $urls) {
    try {
      $zip = Join-Path $env:TEMP 'venus-ffmpeg.zip'
      $tmp = Join-Path $env:TEMP ('ffmpeg-' + [Guid]::NewGuid().ToString('N'))
      Download $u $zip
      Expand-Archive $zip $tmp -Force
      $bin = Get-ChildItem $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
      if (-not $bin) { throw 'ffmpeg.exe absent de l archive' }
      if (Test-Path $FfDir) { Remove-Item $FfDir -Recurse -Force }
      Move-Item $bin.Directory.Parent.FullName $FfDir
      Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
      $done = $true; break
    } catch { Warn "ffmpeg : $u indisponible, autre source..." }
  }
  if (-not $done) { Fail "Impossible de telecharger ffmpeg. Installez-le (winget install Gyan.FFmpeg) puis relancez ce script." }
}
Ok "ffmpeg : $FfExe"

# ---------------------------------------------------------------- reglages
if (-not (Test-Path $ConfFile)) {
  Say "Ou sont vos videos ? (Entree = proposition entre crochets ; vous pourrez tout changer dans Reglages > Bibliotheques)"
  $vid = [Environment]::GetFolderPath('MyVideos')
  $movies = Ask "Dossier des FILMS  [$vid]" $vid
  $shows  = Ask 'Dossier des SERIES (Entree pour passer)' ''
  $anime  = Ask 'Dossier des ANIMES (Entree pour passer)' ''
  $clips  = Ask 'Dossier des CLIPS  (Entree pour passer)' ''
  $port   = Ask 'Port de Venus [8096]' '8096'
  $lines = @('# Reglages de Venus - modifiez puis relancez le script (ou redemarrez le PC)', "PORT=$port")
  if ($movies) { $lines += "MOVIES_PATH=$movies" }
  if ($shows)  { $lines += "SHOWS_PATH=$shows" }
  if ($anime)  { $lines += "ANIME_PATH=$anime" }
  if ($clips)  { $lines += "CLIPS_PATH=$clips" }
  $lines += '# TMDB_API_KEY=votre_cle'
  [IO.File]::WriteAllLines($ConfFile, $lines, (New-Object Text.UTF8Encoding $false))
  Ok "Reglages ecrits dans $ConfFile"
} else { Ok "Reglages existants conserves ($ConfFile)" }

$conf = @{}
foreach ($l in [IO.File]::ReadAllLines($ConfFile)) {
  if ($l -match '^\s*#' -or $l -notmatch '=') { continue }
  $k, $v = $l.Split('=', 2); $conf[$k.Trim()] = $v.Trim()
}
$port = if ($conf['PORT']) { $conf['PORT'] } else { '8096' }

# Lanceur : chcp 65001 pour les accents dans les noms de fichiers, variables de Venus, journal
$cmdLines = @('@echo off', 'chcp 65001 >nul', "cd /d `"$AppDir`"",
  "set `"NODE_ENV=production`"", "set `"DATA_DIR=$DataDir`"", "set `"TRANSCODE_DIR=$Transcode`"",
  "set `"FFMPEG_PATH=$FfExe`"", "set `"FFPROBE_PATH=$(Join-Path $FfDir 'bin\ffprobe.exe')`"")
foreach ($k in $conf.Keys) { $cmdLines += "set `"$k=$($conf[$k])`"" }
# Boucle : si Venus s'arrete (plantage, mise a jour de ffmpeg...), il redemarre 3 secondes plus tard
$cmdLines += ':loop'
$cmdLines += "`"$NodeExe`" --disable-warning=ExperimentalWarning server\index.js >> `"$LogFile`" 2>&1"
$cmdLines += 'ping -n 4 127.0.0.1 >nul'
$cmdLines += 'goto loop'
[IO.File]::WriteAllLines($Launcher, $cmdLines, (New-Object Text.UTF8Encoding $false))

# ---------------------------------------------------------------- demarrage automatique
Stop-Venus
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Launcher`"" -WorkingDirectory $AppDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Venus, serveur multimedia (https://github.com/TOUFATECH/Venus)' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Ok 'Venus demarre maintenant et a chaque demarrage du PC'

# ---------------------------------------------------------------- pare-feu : accessible depuis la TV, le telephone...
Get-NetFirewallRule -DisplayName 'Venus' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Venus' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private, Domain | Out-Null
Ok "Pare-feu : port $port ouvert sur le reseau prive"

# ---------------------------------------------------------------- verification
$up = $false
for ($i = 0; $i -lt 40; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/status" -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep -Seconds 1 }
}
if ($up) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = 'localhost' }
  Write-Host ''
  Write-Host "  Venus fonctionne : http://${ip}:$port   (sur ce PC : http://localhost:$port)" -ForegroundColor Green
  Write-Host "  Journal : $LogFile     Mise a jour : relancez la meme commande"
  Write-Host "  Si votre reseau Wi-Fi est en mode 'Public', passez-le en 'Prive' pour que la TV et le telephone voient Venus."
  Start-Process "http://localhost:$port"
} else {
  Warn "Venus ne repond pas encore. Regardez le journal : $LogFile"
}

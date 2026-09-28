<#
  Bettet die Primaerdaten des Versuchslaufs vom 24.09.2026 woertlich in
  js/rohdaten.js ein, damit der Simulator ohne Webserver (file://) laeuft.
  Die Primaerdaten werden nur gelesen. Die Paketlisten der Mitschnitte und
  die HTTP-Sicht auf den Mitschnitt von asa liest tshark (nur lesend).

  Aufruf:  .\werkzeug\rohdaten-erzeugen.ps1 -Primaerdaten <Pfad zum Ordner Primaerdaten>
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Primaerdaten,
  [string]$Tshark = 'C:\Program Files\Wireshark\tshark.exe'
)
$ErrorActionPreference = 'Stop'
$ziel = Join-Path (Split-Path $PSScriptRoot -Parent) 'js\rohdaten.js'
$inv = [Globalization.CultureInfo]::InvariantCulture

$dateien = @(
  'FRRouting/_RouteServer/mrt-updates-bgpdump.txt',
  'FRRouting/_RouteServer/mrt-rib-bgpdump.txt',
  'FRRouting/_RouteServer/dienst-protokoll.log',
  'FRRouting/_RouteServer/bgp-updates-rs.txt',
  'FRRouting/_RouteServer/bmp-nachrichten.txt',
  'Konfiguration/rs.txt', 'Konfiguration/asa.txt', 'Konfiguration/asb.txt', 'Konfiguration/hijacker.txt',
  'Konfiguration/rs-ausgangszustand-198.51.96.0-20.txt'
)
foreach ($sz in '1_SubPraefix_Vortaeuschen', '2_GleichesPraefix_FalscherUrsprung') {
  foreach ($n in 'rib-aus-dem-ram.txt', 'adj-rib-in-rs.txt', 'adj-rib-in-asa.txt', 'adj-rib-in-asb.txt',
                 'bgp-tabelle-asa.txt', 'bgp-tabelle-asb.txt', 'routing-tabelle-asa.txt', 'routing-tabelle-asb.txt',
                 'messprotokoll-clienta.txt', 'sudo-audit-hijacker.log',
                 'zugriffsprotokoll-webevil.log', 'zugriffsprotokoll-weblegit.log') {
    $dateien += "$sz/$n"
  }
}

$roh = [ordered]@{}
foreach ($rel in $dateien) {
  $pfad = Join-Path $Primaerdaten ($rel -replace '/', '\')
  $text = [IO.File]::ReadAllText($pfad, [Text.Encoding]::UTF8)
  $roh[$rel] = $text -replace "`r`n", "`n"
}

# HTTP-Austausch auf dem Zugangssegment von asa (durchgehender Mitschnitt).
$pcap = Join-Path $Primaerdaten 'FRRouting\_RouteServer\asa_enp0s10.pcap'
$zeilen = & $Tshark -r $pcap -Y 'http' -T fields -e frame.time_epoch -e ip.src -e ip.dst -e http.request.method -e http.request.uri -e http.response.code -e http.content_length -e tcp.len 2>$null
$http = foreach ($z in $zeilen) {
  $f = $z.Split("`t")
  $ep = [decimal]::Parse($f[0], $inv)
  $sek = [Math]::Floor($ep)
  $zeit = [DateTimeOffset]::FromUnixTimeSeconds([long]$sek).ToString('HH:mm:ss') + '.' + ([string]([long](($ep - $sek) * 1000000))).PadLeft(6, '0')
  if ($f[3]) { "$zeit  $($f[1]) -> $($f[2])  $($f[3]) $($f[4]) HTTP/1.1, Draht: $($f[7]) Byte" }
  else { "$zeit  $($f[1]) -> $($f[2])  HTTP $($f[5]), Content-Length $($f[6]), Draht: $($f[7]) Byte" }
}
$roh['abgeleitet/asa_enp0s10-http.txt'] = (@(
  '# HTTP-Austausch im Mitschnitt FRRouting/_RouteServer/asa_enp0s10.pcap (Zugangssegment von asa)',
  "# tshark -r asa_enp0s10.pcap -Y http -T fields (Zeit UTC, Mikrosekunden)",
  ''
) + $http) -join "`n"

# Alle Pakete der durchgehenden Mitschnitte (Spalten wie in Wireshark, ohne Namensaufloesung).
foreach ($m in 'rs_enp0s8', 'rs_lo', 'asa_enp0s8', 'asa_enp0s10', 'hijacker_enp0s8', 'hijacker_enp0s10') {
  $pc = Join-Path $Primaerdaten "FRRouting\_RouteServer\$m.pcap"
  $pakete = & $Tshark -n -r $pc -T fields -E 'separator=/t' -e frame.time_epoch -e _ws.col.Source -e _ws.col.Destination -e _ws.col.Protocol -e frame.len -e _ws.col.Info 2>$null
  $liste = foreach ($z in $pakete) {
    $f = $z.Split("`t")
    $ep = [decimal]::Parse($f[0], $inv)
    $sek = [Math]::Floor($ep)
    $zeit = [DateTimeOffset]::FromUnixTimeSeconds([long]$sek).ToString('HH:mm:ss') + '.' + ([string]([long](($ep - $sek) * 1000000))).PadLeft(6, '0')
    '{0}  {1,-17} {2,-17} {3,-8} {4,5}  {5}' -f $zeit, $f[1], $f[2], $f[3], $f[4], $f[5]
  }
  $roh["abgeleitet/$m-pakete.txt"] = (@(
    "# Alle Pakete im Mitschnitt FRRouting/_RouteServer/$m.pcap",
    "# tshark -n -r $($m).pcap (Zeit UTC, Mikrosekunden)",
    '',
    ('{0,-15}  {1,-17} {2,-17} {3,-8} {4,5}  {5}' -f 'Zeit(UTC)', 'Quelle', 'Ziel', 'Protokoll', 'Länge', 'Info')
  ) + $liste) -join "`n"
}

$json = $roh | ConvertTo-Json -Depth 3
$kopf = "/* Automatisch erzeugt von werkzeug/rohdaten-erzeugen.ps1 am $((Get-Date).ToString('yyyy-MM-dd HH:mm')).`n   Woertliche Inhalte der Primaerdaten (Versuchslauf 24.09.2026). Nicht von Hand bearbeiten. */`n"
[IO.File]::WriteAllText($ziel, $kopf + 'window.ROHDATEN = ' + $json + ";`n", (New-Object Text.UTF8Encoding($false)))
"geschrieben: $ziel ($($roh.Count) Dateien, $([Math]::Round((Get-Item $ziel).Length / 1KB)) KB)"

param(
  [Parameter(Position = 0)][string]$Cmd = "status",
  [int]$Port = 9333,
  [string]$Folder = ""
)
# CDP lifecycle for the throwaway Trae instance. ASCII only (PS 5.1 misreads UTF-8 no-BOM).
$ErrorActionPreference = 'Continue'
$trae      = Join-Path $env:LOCALAPPDATA 'Programs\Trae\Trae.exe'
$marker    = 'trae-cdp-probe'
$probeData = Join-Path $env:TEMP $marker

function Get-Version([int]$p) {
  return (curl.exe -s --noproxy "*" -m 3 ("http://127.0.0.1:" + $p + "/json/version")) 2>$null
}
function Get-List([int]$p) {
  return (curl.exe -s --noproxy "*" -m 3 ("http://127.0.0.1:" + $p + "/json/list")) 2>$null
}
function Write-Targets([string]$list) {
  $items = $list | ConvertFrom-Json
  foreach ($t in $items) {
    $u = $t.url; if ($u.Length -gt 90) { $u = $u.Substring(0, 90) + "..." }
    $ti = $t.title; if ($ti.Length -gt 40) { $ti = $ti.Substring(0, 40) }
    Write-Output ("TARGET type=" + $t.type + " | " + $ti + " | " + $u)
  }
  Write-Output ("TARGET_TOTAL=" + @($items).Count + " PAGE=" + @($items | Where-Object { $_.type -eq "page" }).Count)
}
function Get-ProbeProcs {
  return @(Get-CimInstance Win32_Process -Filter "Name='Trae.exe'" | Where-Object { $_.CommandLine -like ("*" + $marker + "*") })
}

switch ($Cmd) {
  "launch" {
    New-Item -ItemType Directory -Force -Path $probeData | Out-Null
    $a = @(("--user-data-dir=" + $probeData), "--new-window", "--no-first-run",
           "--disable-extensions", "--disable-upgrade", ("--remote-debugging-port=" + $Port))
    # Native folder pickers cannot be driven over CDP, so the workspace is passed as a positional arg.
    if ($Folder -ne "") { $a += $Folder }
    Start-Process -FilePath $trae -ArgumentList $a | Out-Null
    # Gate fix: /json/version answers long before the workbench page target exists.
    # Poll for a page target, not for the endpoint.
    $ready = $false
    for ($i = 0; $i -lt 80; $i++) {
      Start-Sleep -Milliseconds 500
      $l = Get-List $Port
      if ($l -and $l -match '"type"\s*:\s*"page"') { $ready = $true; break }
    }
    if (-not $ready) { Write-Output "LAUNCH=FAIL_NO_PAGE_TARGET"; exit 1 }
    Write-Output "LAUNCH=OK"
    Write-Output ("VERSION=" + ((Get-Version $Port) -replace "\s+", " "))
    Write-Targets $l
  }
  "stop" {
    $procs = Get-ProbeProcs
    foreach ($q in $procs) { Write-Output ("KILL=" + $q.ProcessId); Stop-Process -Id $q.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
    Write-Output ("STOP_LEFT=" + (Get-ProbeProcs).Count)
    Write-Output ("MAIN_ALIVE=" + [bool](Get-CimInstance Win32_Process -Filter "Name='Trae.exe'" |
                 Where-Object { $_.CommandLine -notlike ("*" + $marker + "*") } | Select-Object -First 1))
  }
  "status" {
    $v = Get-Version $Port
    if (-not $v) { Write-Output "STATUS=NO_ENDPOINT"; exit 0 }
    Write-Output "STATUS=OK"
    Write-Targets (Get-List $Port)
  }
  default { Write-Output "usage: trae-cdp.ps1 launch|stop|status [-Port 9333]" }
}

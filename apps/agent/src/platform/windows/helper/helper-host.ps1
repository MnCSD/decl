# Desk Deck helper process.
# The agent starts this once and keeps it running, so the C# code is compiled only once
# and each call takes milliseconds instead of starting a new PowerShell.
#
# Protocol: one JSON object per line.
#   stdin : {"id":1,"cmd":"status"}            (cmd is one of the fixed names below)
#   stdout: {"id":1,"ok":true,"data":{...}}    or {"id":1,"ok":false,"error":"..."}
# The agent only sends commands it built itself; network input never reaches this script.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) # song titles can be non-ASCII

Add-Type -Path $env:DECK_HELPER_CS -ReferencedAssemblies System.Drawing, System.Windows.Forms
[DeskDeck.Native]::EnableDpiAwareness()

# --- WinRT media controls (SMTC: the API behind the Windows media flyout) -------------
# Windows PowerShell 5.1 can load WinRT types with this special syntax.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

# WinRT async calls return IAsyncOperation<T>; this turns one into a .NET Task and waits for it.
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(3000)) { throw 'Windows media call timed out' }
  $task.Result
}

$mediaManager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
  ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$script:artKey = $null   # "title|artist" of the track whose art is cached
$script:artUrl = $null

function Get-Media {
  $session = $mediaManager.GetCurrentSession()
  if ($null -eq $session) { return $null }
  $props = Await ($session.TryGetMediaPropertiesAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ([string]::IsNullOrEmpty($props.Title)) { return $null }

  # Album art changes only with the track, so it's read once per track (it's the slow part).
  $key = "$($props.Title)|$($props.Artist)"
  if ($key -ne $script:artKey) {
    $script:artKey = $key
    $script:artUrl = $null
    if ($null -ne $props.Thumbnail) {
      try {
        $winStream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        # Spotify's thumbnail has its logo baked in under the art; the C# side crops it off.
        $isSpotify = $session.SourceAppUserModelId -like '*Spotify*'
        $script:artUrl = [DeskDeck.Native]::ThumbnailFromWinRtStream($winStream, 240, $isSpotify)
      } catch { $script:artUrl = $null }
    }
  }

  $status = $session.GetPlaybackInfo().PlaybackStatus
  return @{
    playing = ($status -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
    title   = [string]$props.Title
    artist  = [string]$props.Artist
    artUrl  = $script:artUrl
  }
}

# Media buttons: ask the current media session directly; fall back to a media key
# when no app has registered a session.
function Invoke-Media([string]$what) {
  $session = $mediaManager.GetCurrentSession()
  if ($null -ne $session) {
    $op = switch ($what) {
      'playPause' { $session.TryTogglePlayPauseAsync() }
      'next' { $session.TrySkipNextAsync() }
      'previous' { $session.TrySkipPreviousAsync() }
    }
    if (Await $op ([bool])) { return }
  }
  $vk = switch ($what) {
    'playPause' { [DeskDeck.Native]::VK_MEDIA_PLAY_PAUSE }
    'next' { [DeskDeck.Native]::VK_MEDIA_NEXT_TRACK }
    'previous' { [DeskDeck.Native]::VK_MEDIA_PREV_TRACK }
  }
  [DeskDeck.Native]::TapKey($vk)
}

function Get-Volume {
  $level = [DeskDeck.Audio]::GetLevel()
  if ($level -lt 0) { return $null } # no output device
  return @{ level = $level; muted = [DeskDeck.Audio]::GetMute() }
}

function Send-Reply($reply) {
  [Console]::Out.WriteLine(($reply | ConvertTo-Json -Compress -Depth 5))
}

Send-Reply @{ ready = $true }

# --- Main loop: one command per line until the agent closes stdin ------------------------
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = $null
  $replied = $false
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $data = $null
    switch ($req.cmd) {
      'status' { $data = @{ volume = Get-Volume; media = Get-Media } }
      'paths.pictures' { $data = [Environment]::GetFolderPath('MyPictures') } # follows OneDrive redirection
      'volume.set' { [DeskDeck.Audio]::SetLevel([int]$req.arg) }
      'volume.toggleMute' { $null = [DeskDeck.Audio]::ToggleMute() }
      'media.playPause' { Invoke-Media 'playPause' }
      'media.next' { Invoke-Media 'next' }
      'media.previous' { Invoke-Media 'previous' }
      'system.lock' { [DeskDeck.Native]::Lock() }
      'system.screensOff' { [DeskDeck.Native]::MonitorsOff() }
      'system.screenshot' { [DeskDeck.Native]::Screenshot([string]$req.arg); $data = [string]$req.arg }
      'system.sleep' {
        # Reply first: once the PC is asleep nobody would hear the answer.
        Send-Reply @{ id = $id; ok = $true }
        $replied = $true
        Start-Sleep -Milliseconds 500
        [DeskDeck.Native]::Sleep()
      }
      default { throw "Unknown helper command '$($req.cmd)'" }
    }
    if (-not $replied) { Send-Reply @{ id = $id; ok = $true; data = $data } }
  } catch {
    if (-not $replied) { Send-Reply @{ id = $id; ok = $false; error = $_.Exception.Message } }
  }
}

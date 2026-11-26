param([ValidateSet("Backup","Restore")][string]$Mode="Backup",[string]$GistId)
$ErrorActionPreference="Stop"
$gpg=(Get-Command gpg -ErrorAction SilentlyContinue).Source
if (!$gpg) {$gpg=Join-Path $env:ProgramFiles 'Git\usr\bin\gpg.exe'}
$path=Join-Path $env:LOCALAPPDATA 'NegusImage\panel-token.xml'
$name='negus-panel-token.asc'
$tmp=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -Type Directory $tmp | Out-Null
$file=Join-Path $tmp $name
try {
  if ($Mode -eq 'Backup') {
    $secret=Import-Clixml -LiteralPath $path
    [Net.NetworkCredential]::new('',$secret).Password | & $gpg --no-symkey-cache --symmetric --cipher-algo AES256 --armor --output $file
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $file)) {throw 'Encryption failed'}
    $url=gh gist create $file --desc 'Negus Image encrypted panel credential'
    if ($LASTEXITCODE -ne 0) {throw 'GitHub upload failed'}
    Write-Output "Encrypted backup: $url"
  } else {
    if ($GistId -notmatch '^[0-9a-fA-F]+$') {throw 'Supply the Gist ID'}
    gh gist view $GistId --filename $name | Set-Content -Encoding ascii $file
    if ($LASTEXITCODE -ne 0) {throw 'Download failed'}
    $token=(& $gpg --quiet --no-symkey-cache --decrypt $file)
    if ($LASTEXITCODE -ne 0 -or $token -notmatch '^nap_\S+$') {throw 'Decryption failed or unexpected credential'}
    New-Item -Type Directory -Force (Split-Path $path)|Out-Null
    $token | ConvertTo-SecureString -AsPlainText -Force | Export-Clixml -LiteralPath $path
    Write-Output 'Panel credential restored.'
  }
} finally {
  if (Test-Path $file) {Remove-Item -LiteralPath $file}
  [IO.Directory]::Delete($tmp)
}

# StockRidge Android, from the machine that already builds the unpacked exe.
# ANDROID_FLOW 1
# Requires: Windows PowerShell 5.1 or PowerShell 7, JDK 17, Android SDK 35.
# Does not deploy. Does not delete stockridge.db. Does not pass --reset-pin.
# Does not compile the ciphered SQL library. Does not open Turso.

param(
    [string]$Origin = '',
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Fail([string]$Message) {
    Write-Host $Message
    exit 1
}

function Java-Major([string]$JavaExe) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & $JavaExe -version 2>&1 | Out-String
    $ErrorActionPreference = $old
    if ($out -match 'version "(\d+)\.') { return [int]$Matches[1] }
    if ($out -match 'version "1\.(\d+)') { return [int]$Matches[1] }
    return 0
}

function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path)) {
        $List.Add($Path)
    }
}

Write-Host 'ANDROID_FLOW 1'
Write-Host 'This builds a debug APK. It does not deploy. It does not delete stockridge.db. It does not pass --reset-pin.'

$root = Split-Path -Parent $PSScriptRoot
$pkgPath = Join-Path $root 'package.json'
if (-not (Test-Path -LiteralPath $pkgPath)) {
    Fail 'Run this from the destop checkout that already builds the exe. Do not run it from C:\Users\Mohammed Hayatudeen\StockRidge.'
}
$pkg = Get-Content -LiteralPath $pkgPath -Raw
if ($pkg -notmatch '"name"\s*:\s*"destop-stockridge"') {
    Fail 'This folder is not destop-stockridge. Do not build the phone from the parent StockRidge folder.'
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVersion = & node -v
    Write-Host "node $nodeVersion"
    if ($nodeVersion -notmatch '^v(2[2-9]|[3-9][0-9])\.') {
        Write-Host 'Node is below 22. The phone build can still run. The next Electron build cannot. Do not replace Node 22 to satisfy Java.'
    }
} else {
    Write-Host 'node was not found. The phone build does not need it. The unpacked exe does.'
}

$javaCandidates = New-Object 'System.Collections.Generic.List[string]'
if ($env:JAVA_HOME) { Add-Candidate $javaCandidates (Join-Path $env:JAVA_HOME 'bin\java.exe') }
Add-Candidate $javaCandidates (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin\java.exe')
if (${env:ProgramFiles(x86)}) {
    Add-Candidate $javaCandidates (Join-Path ${env:ProgramFiles(x86)} 'Android\Android Studio\jbr\bin\java.exe')
}
Add-Candidate $javaCandidates (Join-Path $env:LOCALAPPDATA 'Programs\Android\Android Studio\jbr\bin\java.exe')

$jdkRoots = @(
    'C:\Program Files\Eclipse Adoptium',
    'C:\Program Files\Microsoft',
    'C:\Program Files\Java',
    'C:\Program Files\Android\Android Studio\jbr'
)
foreach ($jdkRoot in $jdkRoots) {
    if (-not (Test-Path -LiteralPath $jdkRoot)) { continue }
    $found = Get-ChildItem -LiteralPath $jdkRoot -Filter java.exe -Recurse -ErrorAction SilentlyContinue
    if (-not $found) { continue }
    foreach ($item in @($found)) { Add-Candidate $javaCandidates $item.FullName }
}

$javaExe = $null
$javaMajor = 0
foreach ($candidate in $javaCandidates) {
    $major = Java-Major $candidate
    if ($major -ge 17 -and $major -gt $javaMajor) {
        $javaExe = $candidate
        $javaMajor = $major
    }
}
if (-not $javaExe) {
    Fail 'JDK 17 or newer was not found. Install Android Studio, or Temurin 17 from https://adoptium.net/temurin/releases/?version=17. Do not uninstall Node. The till file was not touched.'
}
$env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $javaExe)
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path
Write-Host "java $javaMajor at $javaExe"

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) {
    Fail "Android SDK platform-tools were not found at $sdk. Install Android Studio from https://developer.android.com/studio, or the command-line tools. Do not install them inside the destop folder. The till file was not touched."
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Write-Host "sdk $sdk"

$platform = Join-Path $sdk 'platforms\android-35'
$buildTools = Join-Path $sdk 'build-tools\35.0.0'
if (-not (Test-Path -LiteralPath $platform) -or -not (Test-Path -LiteralPath $buildTools)) {
    $sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (-not (Test-Path -LiteralPath $sdkmanager)) {
        Fail 'API 35 platform or Build-Tools 35.0.0 is missing, and sdkmanager was not found. In Android Studio open SDK Manager and install Android SDK Platform 35, Build-Tools 35.0.0, and Platform-Tools. The till file was not touched.'
    }
    Write-Host 'Installing Android SDK Platform 35 and Build-Tools 35.0.0'
    & $sdkmanager --sdk_root=$sdk 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
    if ($LASTEXITCODE -ne 0) { Fail 'sdkmanager failed. Accept the SDK licenses in Android Studio, then run this script again. The till file was not touched.' }
}
if (-not (Test-Path -LiteralPath $platform) -or -not (Test-Path -LiteralPath $buildTools)) {
    Fail 'API 35 platform or Build-Tools 35.0.0 is still missing. The till file was not touched.'
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$strings = Join-Path $root 'android\app\src\main\res\values\strings.xml'
$stringsBackup = $null
if ($Origin) {
    $trimmed = $Origin.Trim().TrimEnd('/')
    if ($trimmed -notmatch '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$') {
        Fail 'Origin must be an https host, with no path, query, or token.'
    }
    if ($trimmed -match 'turso|ghp_|token|key=|password') {
        Fail 'Do not put a token, a key, or a Turso address in the origin.'
    }
    $stringsBackup = [System.IO.File]::ReadAllText($strings)
    $updated = [regex]::Replace($stringsBackup, 'https://[^<]+', $trimmed)
    if ($updated -eq $stringsBackup) { Fail 'strings.xml has no https origin to replace. The file was not changed.' }
    [System.IO.File]::WriteAllText($strings, $updated, $utf8)
    Write-Host "origin $trimmed"
} else {
    Write-Host 'origin unchanged: the demonstration Worker in strings.xml'
}

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
try {
    $sdkForward = $sdk -replace '\\', '/'
    $localProps = Join-Path $root 'android\local.properties'
    [System.IO.File]::WriteAllText($localProps, "sdk.dir=$sdkForward$([Environment]::NewLine)", $utf8)
    Write-Host 'Wrote android\local.properties. That file stays on this computer.'
    Push-Location (Join-Path $root 'android')
    & .\gradlew.bat assembleDebug --no-daemon
    $buildCode = $LASTEXITCODE
    Pop-Location
    if ($buildCode -ne 0) { Fail 'The Android build failed. stockridge.db was not deleted. Do not pass --reset-pin.' }
} finally {
    if ($null -ne $stringsBackup) {
        [System.IO.File]::WriteAllText($strings, $stringsBackup, $utf8)
        Write-Host 'Restored strings.xml. Do not commit a client Worker into the demonstration checkout.'
    }
}

if (-not (Test-Path -LiteralPath $apk)) { Fail 'assembleDebug finished without app-debug.apk. The till file was not touched.' }
Write-Host "apk $apk"

if ($Origin) {
    $hostName = ([Uri]$Origin.Trim().TrimEnd('/')).Host
    $named = Join-Path $root "android\app\build\outputs\apk\debug\StockRidge-debug-$hostName.apk"
    Copy-Item -LiteralPath $apk -Destination $named -Force
    Write-Host "named $named"
    Write-Host 'Rename is only a copy under app\build. Do not commit the apk.'
}

if ($Install) {
    $listing = & $adb devices
    $ready = @($listing | Where-Object { $_ -match "`tdevice$" })
    if ($ready.Count -ne 1) {
        Write-Host $listing
        Fail 'Need exactly one phone or emulator in the device state. Unplug the other. Do not install this over the Windows till.'
    }
    & $adb install -r $apk
    if ($LASTEXITCODE -ne 0) { Fail 'adb install failed. The Windows till file was not touched.' }
    & $adb shell am start -n com.stockridge.till/.MainActivity
    if ($LASTEXITCODE -ne 0) { Fail 'The APK installed, but the activity did not start. Open StockRidge on the phone by hand.' }
    Write-Host 'Installed on the one connected device and started com.stockridge.till.'
}

Write-Host 'Done. This was not a deploy. The unpacked exe was not rebuilt. stockridge.db was not opened.'
exit 0

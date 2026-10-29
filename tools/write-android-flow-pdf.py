#!/usr/bin/env python3
"""Write the operator paper for building the Android app from the Electron machine."""

from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, NextPageTemplate, PageBreak,
    Paragraph, Spacer, Table, TableStyle, Flowable, KeepTogether, CondPageBreak,
)

pdfmetrics.registerFont(TTFont('Deja', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaBold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaMono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))

INK = HexColor('#1c1915')
MUTED = HexColor('#5c564c')
GREEN = HexColor('#1e4a38')
GREEN_DARK = HexColor('#143028')
PAPER = HexColor('#f7f4ee')
RULE = HexColor('#d9d1c3')
WARN_BG = HexColor('#f3e6d4')
WARN_INK = HexColor('#6a3d12')
CMD_BG = HexColor('#1c2421')
CMD_FG = HexColor('#f4f0e6')
ROW = HexColor('#efeae1')
STOP = HexColor('#8c3b2a')

PAGE_W, PAGE_H = A4


def esc(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


class ColoredBox(Flowable):
    def __init__(self, contents, width, fill, border=None, pad=8, radius=4):
        super().__init__()
        self.contents = contents
        self.box_width = width
        self.fill = fill
        self.border = border
        self.pad = pad
        self.radius = radius
        self._heights = []

    def wrap(self, aw, ah):
        width = min(self.box_width, aw)
        inner = width - self.pad * 2
        total = self.pad
        self._heights = []
        for item in self.contents:
            w, h = item.wrap(inner, ah)
            self._heights.append(h)
            total += h + 3
        total += self.pad - 3
        self.width = width
        self.height = total
        return self.width, self.height

    def draw(self):
        canv = self.canv
        canv.setFillColor(self.fill)
        canv.setStrokeColor(self.border or self.fill)
        canv.setLineWidth(0.6)
        canv.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=1 if self.border else 0)
        inner = self.width - self.pad * 2
        y = self.height - self.pad
        for item, h in zip(self.contents, self._heights):
            y -= h
            item.drawOn(canv, self.pad, y)
            y -= 3


class CommandBlock(Flowable):
    def __init__(self, lines, width):
        super().__init__()
        self.lines = lines
        self.box_width = width
        self.size = 7.6
        self.leading = 10.4
        self.pad = 8

    def wrap(self, aw, ah):
        self.width = min(self.box_width, aw)
        usable = self.width - self.pad * 2
        for line in self.lines:
            if pdfmetrics.stringWidth(line, 'DejaMono', self.size) > usable:
                raise SystemExit('Command line too wide for the page: ' + line)
        self.height = self.pad * 2 + len(self.lines) * self.leading
        return self.width, self.height

    def draw(self):
        canv = self.canv
        canv.setFillColor(CMD_BG)
        canv.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)
        canv.setFillColor(CMD_FG)
        canv.setFont('DejaMono', self.size)
        y = self.height - self.pad - self.size
        for line in self.lines:
            canv.drawString(self.pad, y, line)
            y -= self.leading


class Hairline(Flowable):
    def __init__(self, color=RULE):
        super().__init__()
        self.color = color

    def wrap(self, aw, ah):
        self.width = aw
        self.height = 4
        return self.width, self.height

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(0.4)
        self.canv.line(0, 2, self.width, 2)


def styles():
    s = {}
    s['h1'] = ParagraphStyle('h1', fontName='DejaBold', fontSize=15.5, leading=19, textColor=GREEN_DARK, spaceAfter=6)
    s['h2'] = ParagraphStyle('h2', fontName='DejaBold', fontSize=11.5, leading=14.5, textColor=GREEN, spaceBefore=8, spaceAfter=4)
    s['body'] = ParagraphStyle('body', fontName='Deja', fontSize=9.2, leading=12.6, textColor=INK, spaceAfter=6)
    s['small'] = ParagraphStyle('small', fontName='Deja', fontSize=8, leading=10.6, textColor=MUTED, spaceAfter=4)
    s['label'] = ParagraphStyle('label', fontName='DejaBold', fontSize=8, leading=10.5, textColor=GREEN_DARK, spaceAfter=2)
    s['warn'] = ParagraphStyle('warn', fontName='Deja', fontSize=8.6, leading=11.6, textColor=WARN_INK)
    s['warnb'] = ParagraphStyle('warnb', fontName='DejaBold', fontSize=8.6, leading=11.6, textColor=WARN_INK, spaceAfter=2)
    s['cell'] = ParagraphStyle('cell', fontName='Deja', fontSize=7.7, leading=10.2, textColor=INK)
    s['cellb'] = ParagraphStyle('cellb', fontName='DejaBold', fontSize=7.7, leading=10.2, textColor=GREEN_DARK)
    s['cover_kicker'] = ParagraphStyle('ck', fontName='DejaBold', fontSize=8.5, leading=11, textColor=HexColor('#d7e6dc'), tracking=0.6)
    s['cover_title'] = ParagraphStyle('ct', fontName='DejaBold', fontSize=26, leading=31, textColor=white)
    s['cover_sub'] = ParagraphStyle('cs', fontName='Deja', fontSize=11, leading=15.2, textColor=HexColor('#e7f0ea'))
    s['fact_h'] = ParagraphStyle('fh', fontName='DejaBold', fontSize=8, leading=10.5, textColor=GREEN_DARK, spaceAfter=2)
    s['fact'] = ParagraphStyle('fact', fontName='Deja', fontSize=8, leading=10.8, textColor=INK)
    s['check'] = ParagraphStyle('check', fontName='Deja', fontSize=9, leading=12.2, textColor=INK, spaceAfter=3)
    return s


S = styles()


def P(text, style='body'):
    return Paragraph(text, S[style])


def warn(title, text, width):
    return ColoredBox([P(title, 'warnb'), P(text, 'warn')], width, WARN_BG, HexColor('#e0c7a4'), pad=8)


def cmd(lines, width):
    return CommandBlock(lines, width)


def table(headers, rows, col_widths):
    data = [[P(h, 'cellb') for h in headers]]
    for row in rows:
        data.append([P(cell, 'cell') for cell in row])
    style = TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HexColor('#e5efe9')),
        ('BACKGROUND', (0, 1), (-1, -1), HexColor('#fffdf8')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#fffdf8'), ROW]),
        ('TEXTCOLOR', (0, 0), (-1, -1), INK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.3, RULE),
    ])
    return Table(data, colWidths=col_widths, style=style, repeatRows=1)


def draw_later(canv, doc):
    canv.saveState()
    canv.setFillColor(PAPER)
    canv.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canv.setFillColor(GREEN_DARK)
    canv.rect(0, PAGE_H - 28, PAGE_W, 28, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.setFont('DejaBold', 8)
    canv.drawString(36, PAGE_H - 18, 'StockRidge')
    canv.setFont('Deja', 8)
    canv.drawRightString(PAGE_W - 36, PAGE_H - 18, 'Android from the Electron machine')
    canv.setFillColor(GREEN)
    canv.rect(0, 0, PAGE_W, 26, fill=1, stroke=0)
    canv.setFillColor(HexColor('#e7f0ea'))
    canv.setFont('Deja', 7.5)
    canv.drawString(36, 10, '29 Oct 2026.  Not deployed.  Not the Windows till file.  Do not pass --reset-pin.')
    canv.drawRightString(PAGE_W - 36, 10, 'Page %d' % doc.page)
    canv.restoreState()


def cover_flowables(width):
    story = []
    story.append(Spacer(1, 36))
    story.append(P('OPERATOR PAPER  ·  29 OCTOBER 2026', 'cover_kicker'))
    story.append(Spacer(1, 10))
    story.append(P('From the Electron machine<br/>to the Android app', 'cover_title'))
    story.append(Spacer(1, 12))
    story.append(P(
        'For the Windows computer that already builds the unpacked StockRidge.exe in PowerShell. '
        'This paper adds the tools that exe does not need, then builds a debug APK and starts it on a phone.',
        'cover_sub'))
    story.append(Spacer(1, 16))
    facts = [
        ('Already on this PC', 'Node.js 22.12 or newer. The destop folder. The stockridge folder beside it. A working unpacked exe.'),
        ('Add for the phone', 'JDK 17. Android SDK Platform 35. Build-Tools 35.0.0. A phone on a data cable, or an emulator.'),
        ('Leave alone', 'stockridge.db and stockridge.key. The portable exe. The parent StockRidge folder. The Turso token.'),
    ]
    fact_width = (width - 16) / 3
    cells = []
    for title, text in facts:
        cells.append(ColoredBox([P(title, 'fact_h'), P(esc(text), 'fact')], fact_width, HexColor('#f7f4ee'), pad=8))
    story.append(Table([cells], colWidths=[fact_width + 5] * 3))
    story.append(Spacer(1, 14))
    story.append(P(
        'The phone is a window around the same Worker the browser uses. It is not a second copy of the Windows till. '
        'Signing in on the phone is another device. One account, one device still stands.',
        'cover_sub'))
    story.append(Spacer(1, 18))
    story.append(P('THE PATH', 'cover_kicker'))
    story.append(Spacer(1, 8))
    steps = [
        ('1  Confirm', 'Same destop folder. Pull. The script must exist. Node stays at 22.12 or newer.'),
        ('2  Add the tools', 'JDK 17 and Android SDK Platform 35. Do not install them inside the destop folder.'),
        ('3  Build', 'Run the Android script. It must print ANDROID_FLOW 1. It does not open the till file.'),
        ('4  One phone', 'Install the debug APK on one device. Close the unpacked exe before a shop sign-in, or the phone takes the account.'),
    ]
    for title, text in steps:
        story.append(ColoredBox(
            [P(esc(title), 'fact_h'), P(esc(text), 'fact')],
            PAGE_W - 80, HexColor('#f7f4ee'), pad=7))
        story.append(Spacer(1, 6))
    story.append(Spacer(1, 6))
    story.append(P('Start at section 1. Do not skip the stop list.', 'cover_kicker'))
    return story


def draw_cover(canv, doc):
    canv.saveState()
    canv.setFillColor(GREEN_DARK)
    canv.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canv.setFillColor(GREEN)
    canv.rect(0, 0, 10, PAGE_H, fill=1, stroke=0)
    canv.setFillColor(HexColor('#b7d0c4'))
    canv.setFont('Deja', 8)
    canv.drawString(40, 22, 'Not a deploy.  Not a Play listing.  Not the Windows till file.')
    canv.restoreState()


def build(path):
    doc = BaseDocTemplate(
        path,
        pagesize=A4,
        title='StockRidge — from the Electron machine to the Android app',
        author='StockRidge',
        subject='PowerShell path from a working unpacked exe to a debug APK. Not a deploy.',
    )
    cover_frame = Frame(40, 36, PAGE_W - 80, PAGE_H - 72, id='cover', showBoundary=0)
    body_frame = Frame(36, 40, PAGE_W - 72, PAGE_H - 78, id='body', showBoundary=0)
    doc.addPageTemplates([
        PageTemplate(id='cover', frames=[cover_frame], onPage=draw_cover),
        PageTemplate(id='body', frames=[body_frame], onPage=draw_later),
    ])
    width = PAGE_W - 72
    story = []
    story.extend(cover_flowables(PAGE_W - 80))
    story.append(NextPageTemplate('body'))
    story.append(PageBreak())

    def h1(text):
        story.append(P(text, 'h1'))
        story.append(Hairline())
        story.append(Spacer(1, 6))

    def h2(text):
        story.append(P(text, 'h2'))

    def body(text):
        story.append(P(text, 'body'))

    def small(text):
        story.append(P(text, 'small'))

    h1('1. Stop list')
    body('Read this before you download Android Studio. The computer in front of you already builds the Windows till. The phone build must not undo that.')
    stops = [
        'Do not delete stockridge.db, stockridge.key, or a file set aside as unreadable.',
        'Do not pass --reset-pin. Do not store the PIN. Do not put a Turso token, a Cloudflare token, or an R2 key in the phone.',
        'Do not deploy. This paper does not publish the website and does not mark a till fix Success.',
        'Do not git pull inside C:\\Users\\Mohammed Hayatudeen\\StockRidge. Pull destop and stockridge in their own folders.',
        'Do not open the portable exe. Do not rebuild the unpacked exe as a step of the phone build.',
        'Do not run npm run rebuild. The ciphered SQL library is an N-API prebuild. The phone does not compile it.',
        'Do not create a second Turso database for the phone. The phone, the PWA, the office host, and the Windows till already share one.',
        'Do not sign the shop account into the phone and the unpacked exe and expect both to stay signed in.',
    ]
    for line in stops:
        story.append(P('•  ' + esc(line), 'body'))

    story.append(warn(
        'What the phone is',
        'A WebView around the Worker named in android\\app\\src\\main\\res\\values\\strings.xml. '
        'The repository value is https://sample.stockridge.workers.dev. The office host '
        'https://stockridge.stockridge.workers.dev is the same books. The phone removes Download and Install. '
        'Chrome on the phone does not. The phone does not open the Windows SQL file.',
        width))
    story.append(Spacer(1, 8))

    h1('2. The two flows, side by side')
    body('The left column is the flow this computer already knows. Leave it alone while you build the phone. The right column is the new flow. Same folder. Different tools. Different result.')
    story.append(table(
        ['Windows till, already working', 'Android, this paper'],
        [
            ['Destop folder you already use', 'That same destop folder. Not the parent StockRidge folder.'],
            ['Node.js 22.12 or newer', 'Keep that Node. Add JDK 17 beside it. Do not replace Node with Java.'],
            ['npm install, then stage-ui', 'Do not stage the screens for the phone. The phone loads the deployed Worker.'],
            ['electron-builder, unpacked exe', 'Gradle wrapper, debug APK. No electron-builder. No portable exe.'],
            ['Open dist\\win-unpacked\\StockRidge.exe', 'adb install, then the StockRidge icon on the phone.'],
            ['Local SQL file, ciphered, not deleted', 'No stockridge.db on the phone. Do not copy the Windows file across.'],
            ['Sync through the Worker. No Turso token.', 'Same door. The phone does not open Turso either.'],
            ['One account, one device', 'A phone sign-in is the other device. It takes the account.'],
        ],
        [width * 0.48, width * 0.52],
    ))
    story.append(Spacer(1, 8))
    body('The unpacked exe is Electron 44.10.0, electron-builder 26.18.1, and better-sqlite3-multiple-ciphers 13.0.3. That set stays. Electron 45 and electron-builder 27 are not the phone build either.')
    small('Stockridge main 8c1739a is the web checkout. It is not deployed. The phone will not show that checkout. It shows whatever the Worker already serves. Do not deploy to make the phone match the till.')

    h1('3. What you already have')
    body('Confirm the machine before you add anything. Close the unpacked exe only if you are about to sign the same account in on the phone. Closing it is not required to compile the APK.')
    story.append(cmd([
        'cd <the destop folder you already use>',
        'git pull origin main',
        'git rev-parse --short HEAD',
        'Test-Path .\\tools\\android-from-electron.ps1',
        'node -v',
    ], width))
    story.append(Spacer(1, 6))
    body('Test-Path must print True. If it prints False, this checkout is still the Electron-only tip. Pull again. Do not invent the script by hand.')
    body('node -v must still print v22.12 or a newer 22, or a later major. If a Java installer changed it, put Node 22.12 back before the next exe build. This paper does not rebuild the exe.')
    body('git rev-parse must not be a02e56f or 1513c22 if those commits do not contain the script. The commit you want is the destop main tip that contains this PDF and tools\\android-from-electron.ps1.')
    story.append(warn(
        'Folders',
        'destop and stockridge sit next to each other, each with its own .git. '
        'The Android project is destop\\android. There is no separate phone repository. '
        'Do not clone a third copy into C:\\Users\\Mohammed Hayatudeen\\StockRidge.',
        width))

    h1('4. What to install')
    body('The exe did not need a JDK or an Android SDK. The phone does. Keep at least 8 GB free. Do not install Android Studio inside the destop folder, and do not install it over the till backup.')
    story.append(table(
        ['Piece', 'Version this project uses', 'Why'],
        [
            ['JDK', '17 or newer. Android Studio brings one.', 'Gradle 8.9 will not run on Java 11.'],
            ['Android Studio', 'Rabbit 2, 2026.2.2, from the page below.', 'SDK Manager, and an emulator if you want one.'],
            ['SDK Platform', 'Android 15, API 35', 'compileSdk 35. An older platform will not build this project.'],
            ['Build-Tools', '35.0.0', 'The app module names this revision.'],
            ['Platform-Tools', 'Current adb from the same SDK', 'Installs the APK. Not a second adb from an old path.'],
            ['Gradle', '8.9, through android\\gradlew.bat', 'Do not install a random Gradle and call it by hand.'],
            ['Android Gradle Plugin', '8.7.3, already in settings.gradle', 'Do not accept a Studio prompt to jump further.'],
            ['Phone', 'Android 7 or newer', 'minSdk 24. A charge-only cable will look like a missing phone.'],
        ],
        [width * 0.24, width * 0.40, width * 0.36],
    ))
    story.append(Spacer(1, 8))
    h2('Preferred path: Android Studio')
    body('Download only from https://developer.android.com/studio. On 29 October 2026 the Windows installer on that page was android-studio-rabbit2-windows.exe, 1.5 GB. If the file name on the page has changed, use the name on the page. Do not take the installer from another site.')
    story.append(cmd([
        'Get-FileHash .\\android-studio-rabbit2-windows.exe -Algorithm SHA256',
    ], width))
    story.append(Spacer(1, 4))
    story.append(cmd([
        '260af2d6220f1b7239eef0bce4970f9e444c881d42ed994c4fc0c68b07ef85f8',
    ], width))
    story.append(Spacer(1, 4))
    small('That is the hash read from the page on 29 October 2026. If the file name changed, use the hash printed beside the new name. If the hash does not match, do not run the file.')
    body('Run the installer. Include the Android SDK and Android Virtual Device. First launch: Standard. Let it put the SDK in %LOCALAPPDATA%\\Android\\Sdk. Do not point the SDK at the destop folder.')
    body('Then Tools, SDK Manager. On the SDK Platforms tab, tick Android 15.0 (API 35). On the SDK Tools tab, tick Android SDK Build-Tools 35, Android SDK Platform-Tools, and Android SDK Command-line Tools. Apply, and accept the licenses.')
    body('Studio’s own JDK is enough. You do not have to install a second Java. The script looks in C:\\Program Files\\Android\\Android Studio\\jbr first when JAVA_HOME is missing or too old.')
    h2('Command-line path, if you will not use an emulator')
    body('A real phone does not need Android Studio. You still need JDK 17 and the SDK. Install Temurin 17 from https://adoptium.net/temurin/releases/?version=17 and check the checksum published on that page next to the file. Do not let that installer become your Node.')
    body('The command-line tools package on the same Android Studio page, read on 29 October 2026, was commandlinetools-win-15859902_latest.zip. Check it the same way. If the name on the page has changed, stop and use that name and its printed hash.')
    story.append(cmd([
        '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
    ], width))
    story.append(Spacer(1, 4))
    story.append(cmd([
        '$sdk = "$env:LOCALAPPDATA\\Android\\Sdk"',
        'New-Item -ItemType Directory -Force -Path "$sdk\\cmdline-tools" | Out-Null',
        'Expand-Archive .\\commandlinetools-win-15859902_latest.zip -DestinationPath "$sdk\\cmdline-tools"',
        'Rename-Item "$sdk\\cmdline-tools\\cmdline-tools" "$sdk\\cmdline-tools\\latest"',
    ], width))
    story.append(Spacer(1, 6))
    body('The zip extracts a folder named cmdline-tools. It must end up as cmdline-tools\\latest\\bin\\sdkmanager.bat. If you unzip twice, you get cmdline-tools\\cmdline-tools and sdkmanager will not be found. Fix the folders. Do not delete the till file because the zip layout was wrong.')
    story.append(cmd([
        '$env:JAVA_HOME = "C:\\Program Files\\Eclipse Adoptium\\jdk-17"',
        '$env:Path = "$env:JAVA_HOME\\bin;" + $env:Path',
        'java -version',
        '$sm = "$sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat"',
        '& $sm --sdk_root=$sdk --licenses',
        '& $sm --sdk_root=$sdk "platforms;android-35"',
        '& $sm --sdk_root=$sdk "build-tools;35.0.0" "platform-tools"',
    ], width))
    story.append(Spacer(1, 6))
    small('Replace the Temurin path with the folder the installer actually created. java -version must say 17 or newer. At the license prompts, type y. This is the Android SDK license, not a shop signing key.')

    h1('5. Build the debug APK')
    body('Open a new PowerShell in the destop folder. The execution-policy change lasts for that window only. It does not change the computer’s policy.')
    story.append(cmd([
        'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass',
        '.\\tools\\android-from-electron.ps1',
    ], width))
    story.append(Spacer(1, 6))
    body('The first lines must include ANDROID_FLOW 1, the Node version, a Java of 17 or newer, and the SDK path. The script then writes android\\local.properties on this computer only. That file is not committed. The first Gradle run downloads Gradle 8.9. It needs the internet. It can take several minutes. Do not cancel it, and do not start a second copy beside it.')
    body('When it finishes, it prints the APK path:')
    story.append(cmd([
        'android\\app\\build\\outputs\\apk\\debug\\app-debug.apk',
    ], width))
    story.append(Spacer(1, 6))
    body('It must also print that this was not a deploy, that the unpacked exe was not rebuilt, and that stockridge.db was not opened. If those sentences are missing, you did not run this script.')
    h2('The same build, typed by hand')
    body('Use this only if you will not run the script. The result must be the same file. Do not add flags.')
    story.append(cmd([
        '$env:JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr"',
        '$env:Path = "$env:JAVA_HOME\\bin;" + $env:Path',
        'java -version',
        '$env:ANDROID_HOME = "$env:LOCALAPPDATA\\Android\\Sdk"',
        '$sdk = $env:ANDROID_HOME -replace "\\\\", "/"',
        'Set-Content .\\android\\local.properties "sdk.dir=$sdk" -Encoding ascii',
        'Push-Location .\\android',
        '.\\gradlew.bat assembleDebug --no-daemon',
        'Pop-Location',
    ], width))
    story.append(Spacer(1, 6))
    body('assembleDebug is the only Gradle task in this paper. Do not run assembleRelease. A release APK wants a signing key, and that key is not in this folder. Do not generate a key “just to see”. Do not commit a key.')
    story.append(warn(
        'Studio may offer a newer plugin',
        'Decline it. This project is Android Gradle Plugin 8.7.3 and Gradle 8.9. '
        'A newer plugin is a different build, and this paper does not cover it. '
        'The same rule as the till: do not bump one piece because a notice said a newer number exists.',
        width))

    h1('6. Put it on a phone')
    body('Use one phone. Unplug every other phone. Close any emulator. adb must see exactly one device, or the install can land on the wrong one.')
    h2('On the phone')
    body('Android 7 or newer. Settings, About phone, tap Build number seven times. Back, System, Developer options, turn on USB debugging. Some phones hide Developer options under Additional settings. Plug in a cable that carries data. When the phone asks, allow USB debugging, and tick always allow from this computer.')
    story.append(cmd([
        '& "$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools\\adb.exe" devices',
    ], width))
    story.append(Spacer(1, 6))
    body('A good line ends with the word device. unauthorized means the phone prompt was not accepted. empty means the cable, the driver, or USB debugging. Do not keep typing install against an empty list. An OEM driver, if the phone maker requires one, comes from that maker. Do not download a “universal adb driver” from a random page.')
    story.append(cmd([
        '$adb = "$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools\\adb.exe"',
        '& $adb install -r .\\android\\app\\build\\outputs\\apk\\debug\\app-debug.apk',
        '& $adb shell am start -n com.stockridge.till/.MainActivity',
    ], width))
    story.append(Spacer(1, 6))
    body('Or, after the APK exists, the script can do the install itself. It refuses unless exactly one device is in the device state.')
    story.append(cmd([
        '.\\tools\\android-from-electron.ps1 -Install',
    ], width))
    story.append(Spacer(1, 6))
    body('-Install builds again, then installs. It does not need a second manual adb install. The package name is com.stockridge.till. The icon name is StockRidge. There is no browser bar.')
    h2('Emulator, only if you have no phone')
    body('In Android Studio open Device Manager, Create Device, pick a phone, and choose a system image for API 35 with Google APIs. An x86_64 image matches a normal Windows PC. Start the device and wait until the home screen is up. adb devices then shows emulator-5554. Use the same install commands.')
    body('If the emulator says the hypervisor is missing, the shop PC may not be the right place to turn that on. Prefer a real phone. Enabling Windows Hypervisor Platform can ask for a restart. Close the unpacked exe before you restart, so Windows does not leave a file locked. Do not delete dist, and do not delete the till file, to get past a lock.')
    story.append(warn(
        'One account, one device',
        'Before you type the shop password on the phone, close the unpacked exe, or accept that the phone will take the account. '
        'The Windows till is then the other device. That is the product rule, not a failed install. '
        'Do not pass --reset-pin to get the till back. Sign in on the till again when you want the account there.',
        width))

    h1('7. What you should see')
    body('The phone opens the Worker in strings.xml. On the demonstration build that is the sample host. The office host is the same books. You should see the shop sign-in, full screen, with no Download button and no Install button.')
    story.append(table(
        ['You see', 'What it means'],
        [
            ['Sign-in page, no Install button', 'This APK. Continue only if you meant to use this account on the phone.'],
            ['Install or Download still visible', 'This is Chrome, or an old APK. Do not ship it. Build this commit again.'],
            ['Blank page', 'The phone has no route to the Worker, or the origin string is wrong. It is not a missing till file.'],
            ['The Windows offline till, with this PC’s sales', 'That cannot be this APK. The phone does not open stockridge.db. You opened the exe.'],
            ['Another device has this account', 'Expected if the unpacked exe is still signed in. Close one of them. Do not keep both.'],
            ['A newer till fix from the unpacked exe', 'Not on the phone. The phone shows the deployed Worker. 8c1739a was not deployed.'],
        ],
        [width * 0.42, width * 0.58],
    ))
    story.append(Spacer(1, 8))
    body('A sale typed on the phone while it is online goes through the Worker, into the shared books. It is not written into the Windows stockridge.db by the act of installing the APK. The Windows till sees that sale on its next successful copy, after it is the signed-in device again.')
    body('A sale typed on the phone while it is offline stays in the phone’s own browser storage. This APK does not have the Windows till’s SQL file, and this paper does not move that queue. Do not try to copy the phone’s storage onto stockridge.db. Do not delete either side to force them to match.')
    small('Offline SQLite on Android, a Play Store listing, and a signed shop release are not this build. Do not describe the debug APK as those things.')

    h1('8. A client copy')
    body('The address in the repository is the demonstration. It must not be the APK you hand to a different client. Do not create a database for them. Their Worker, if they have one, is the only address that changes.')
    story.append(cmd([
        '.\\tools\\android-from-electron.ps1 -Origin https://client.example.workers.dev',
    ], width))
    story.append(Spacer(1, 6))
    body('The origin must be https, a host only, with no path, no query, and no token. The script puts that host into the APK, then restores strings.xml so the demonstration checkout does not keep the client address. It also copies the APK to a name with that host, still under app\\build, which is not committed.')
    body('Before the files can be mixed up, copy that named APK out of the build folder and rename it with the client’s name. Do not commit the APK. Do not commit a changed strings.xml. If git status shows strings.xml, the restore did not run. Put the demonstration address back before you commit anything.')
    body('A shop release, later, needs a signing key that stays with that client. Generate it on their machine when they ask for a release. Do not commit it. Do not put it in chat. Do not email it to yourself “for safety”. This paper stops at the debug APK.')

    h1('9. If a step fails')
    story.append(table(
        ['The message', 'What to do'],
        [
            ['Test-Path printed False', 'You are not on the destop tip that contains the script. Pull destop. Do not pull the parent folder.'],
            ['JAVA_HOME is Java 11', 'Point JAVA_HOME at Studio’s jbr, or install Temurin 17. Do not uninstall Node to fix Java.'],
            ['SDK location not found', 'android\\local.properties must be sdk.dir with forward slashes. Run the script again. It rewrites that file.'],
            ['Failed to find Build Tools 35.0.0', 'SDK Manager, SDK Tools, Build-Tools 35. Then run the script again. Do not compile SQLite instead.'],
            ['Gradle wrapper download failed', 'The PC needs the internet once, to services.gradle.org. Run the same command again. Do not delete the till file.'],
            ['Studio wants to upgrade the plugin', 'Decline. Stay on 8.7.3 and the wrapper’s Gradle 8.9.'],
            ['adb devices is empty', 'Data cable, USB debugging, phone prompt. Not a database problem.'],
            ['unauthorized', 'Unlock the phone and accept the RSA prompt. Then run adb devices again.'],
            ['More than one device', 'Unplug the extra phone and close the emulator. The script will not guess.'],
            ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', 'An older StockRidge with another signature is on the phone. Uninstall that icon, then install again. Do not uninstall the Windows exe.'],
            ['Blank WebView', 'Check the phone’s internet and the origin string. Do not add a Turso token to “make it load”.'],
            ['The till will not open afterwards', 'You deleted or moved stockridge.db, or you are opening the portable exe. Restore the file from the copy you already had. Do not create a new empty file and call it the till.'],
        ],
        [width * 0.38, width * 0.62],
    ))
    story.append(Spacer(1, 8))
    body('A failed phone build does not require a till repair. The script never opens the till file. If the unpacked exe fails after this work, it failed for a till reason, not because Gradle ran. Close the old window, pull destop, confirm Node is still 22.12 or newer, and build the unpacked exe only when you mean to build the till. Do not open the portable exe. Do not pass --reset-pin.')

    h1('10. Back on the Windows till')
    body('This paper does not replace the exe sequence. When you next build the till, use the destop tip you pulled, not an older note that says a02e56f or 1513c22.')
    story.append(cmd([
        'node -v',
        'npm install',
        'node .\\tools\\stage-ui.js',
        'node .\\node_modules\\electron-builder\\cli.js --win dir --config.win.signAndEditExecutable=false',
        '.\\dist\\win-unpacked\\StockRidge.exe',
    ], width))
    story.append(Spacer(1, 6))
    body('Do not run npm run rebuild between those lines. Do not delete stockridge.db so the new runtime will start. Do not deploy. If the phone still holds the account, the till will be told it is the other device until you sign in on the till again. That is the rule.')
    story.append(Hairline(GREEN))
    story.append(Spacer(1, 6))
    h2('Tick this before you call the phone done')
    checks = [
        'node -v is still v22.12 or newer.',
        'The script printed ANDROID_FLOW 1, and it printed that stockridge.db was not opened.',
        'app-debug.apk exists. It was not committed.',
        'Exactly one phone or emulator was installed to.',
        'The phone shows StockRidge with no Install button and no Download button.',
        'strings.xml is still the demonstration address, unless this build was a client copy that you did not commit.',
        'stockridge.db and stockridge.key are still where they were.',
        'You did not pass --reset-pin, and you did not deploy.',
        'You did not pull C:\\Users\\Mohammed Hayatudeen\\StockRidge, and you did not open the portable exe.',
        'You know the phone sign-in takes the account from the unpacked exe.',
    ]
    for line in checks:
        story.append(P('☐   ' + esc(line), 'check'))
    doc.build(story)
    print(path)


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '/home/user/destop-stockridge/docs/android-from-the-electron-machine.pdf'
    build(out)

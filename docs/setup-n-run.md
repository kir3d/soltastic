# Setup and Run Guide

This guide explains how to prepare the environment, run the local Soltastic web/server prototype, and build/install the Android version.

It is written for three groups of users:

- people familiar with Solana but not Meshtastic;
- people familiar with Meshtastic but not Solana;
- people who have not used either before.

---

## What you need before starting

Soltastic connects three worlds:

```text
Solana wallet/signing
        +
Meshtastic / LoRa radio transport
        +
Soltastic Gateway with internet access
```

Before running the project, you need the following.

### Required for the local web/server version

| Requirement | Why it is needed |
|---|---|
| Computer with macOS, Linux, or Windows | Runs the Soltastic local web client and gateway server |
| BLE interface on the computer | Required if the browser/client connects to a Meshtastic node over Bluetooth |
| Meshtastic device | Sends and receives LoRa mesh messages |
| Internet access on the gateway computer | Required to submit transactions to Solana RPC |
| Git | Downloads the source code |
| Node.js + npm | Runs the TypeScript/JavaScript server and web client |
| Chromium-based browser | Required for Web Bluetooth, for example Chrome or Edge |
| Solana wallet | Signs transactions locally |

### Required for Android APK build

| Requirement | Why it is needed |
|---|---|
| Android smartphone | Runs the Android Soltastic prototype |
| BLE support on the phone | Required to connect to the Meshtastic node |
| Meshtastic device | Radio transport for the Android client |
| Android Studio | Required to build and install the Android APK |
| Android SDK | Required by Gradle to compile Android apps |
| JDK | Required for Android/Gradle builds |
| NDK | Required if the mobile project or dependencies need native modules |
| CMake / LLDB | Often required together with NDK for native Android builds |
| USB cable | Used to install the APK on the phone |
| USB debugging enabled | Allows `adb` to install and debug the app |

> Important: for Android builds, install Android Studio first and make sure the required JDK, SDK, NDK, CMake, and platform tools are installed.

---

## Recommended file name

Use this file as:

```text
docs/setup-and-run.md
```

This name is clearer than `quickstart.md` because the document covers full installation and setup, not only a short demo start.

Recommended docs structure:

```text
docs/
├── architecture.md
├── protocol.md
├── setup-and-run.md
└── security.md
```

If you want to keep only one setup document, `setup-and-run.md` can include both local web/server and Android instructions.

---

## 1. Install Git

Git is used to download the Soltastic source code.

### macOS

Option A: install Git through Xcode Command Line Tools:

```bash
xcode-select --install
```

Then check:

```bash
git --version
```

Option B: install through Homebrew:

```bash
brew install git
git --version
```

### Linux

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git
git --version
```

Fedora:

```bash
sudo dnf install -y git
git --version
```

Arch Linux:

```bash
sudo pacman -S git
git --version
```

### Windows

Recommended option: install Git for Windows.

After installation, open **PowerShell** or **Git Bash** and check:

```powershell
git --version
```

If you use Windows Package Manager:

```powershell
winget install --id Git.Git -e
git --version
```

---

## 2. Install Node.js and npm

Node.js runs the local Soltastic server and web client.

Recommended: use the current LTS version of Node.js.

### macOS

Option A: official installer.

Download and install Node.js LTS from the official Node.js website.

Then check:

```bash
node -v
npm -v
```

Option B: Homebrew:

```bash
brew install node
node -v
npm -v
```

Option C: nvm:

```bash
brew install nvm
mkdir -p ~/.nvm
```

Add this to your shell config file, for example `~/.zshrc`:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"
```

Restart terminal, then:

```bash
nvm install --lts
nvm use --lts
node -v
npm -v
```

### Linux

Recommended: nvm.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

Restart terminal or run:

```bash
source ~/.bashrc
```

Then:

```bash
nvm install --lts
nvm use --lts
node -v
npm -v
```

Ubuntu / Debian alternative:

```bash
sudo apt update
sudo apt install -y nodejs npm
node -v
npm -v
```

If the installed Node.js version is old, use nvm instead.

### Windows

Option A: official Node.js LTS installer.

After installation, open PowerShell:

```powershell
node -v
npm -v
```

Option B: Windows Package Manager:

```powershell
winget install OpenJS.NodeJS.LTS
node -v
npm -v
```

Option C: nvm for Windows.

Install nvm-windows, then:

```powershell
nvm install lts
nvm use lts
node -v
npm -v
```

---

## 3. Install a Chromium-based browser

The local web version uses Web Bluetooth to connect to a Meshtastic node.

Use:

- Google Chrome;
- Microsoft Edge;
- another Chromium-based browser with Web Bluetooth support.

Firefox and Safari are not recommended for the local BLE web prototype.

Check that Bluetooth is enabled on your computer before opening the Soltastic web client.

---

## 4. Prepare a Meshtastic device

You need at least one Meshtastic device for the client side.

For a full radio test, you usually need two Meshtastic devices:

| Device | Role |
|---|---|
| Client-side node | Connected to the user's computer or Android phone |
| Gateway-side node | Connected to the Soltastic Gateway computer |

For a minimal development setup, the exact number of devices depends on your test topology.

### Basic Meshtastic preparation

1. Flash or update Meshtastic firmware if needed.
2. Enable Bluetooth on the device.
3. Put the device into pairing mode if required.
4. Configure the LoRa region correctly for your country.
5. Configure the same channel settings on client and gateway devices.
6. For current Soltastic prototype, use channel slot `7`.
7. Prefer a private channel for testing.
8. Keep hop limit low during development.
9. Do not test high-frequency traffic on public community channels.

### Important Bluetooth note

A Meshtastic node usually can be connected to one client at a time.

If your phone is connected to the Meshtastic node through the official Meshtastic app, disconnect it before trying to connect from the Soltastic browser client or Android prototype.

### ESP32 note

On some ESP32 Meshtastic devices, Bluetooth may be disabled if Wi-Fi is enabled. If BLE does not appear, check the device Bluetooth/Wi-Fi configuration.

---

## 5. Prepare a Solana wallet

You need a Solana wallet for signing.

For development, use Solana devnet only.

Recommended:

- create or use a test wallet;
- never use a wallet with real funds while testing;
- switch the wallet to devnet if the wallet supports network selection;
- fund the test wallet with devnet SOL.

The wallet private key must never be pasted into Soltastic or committed to the repository.

The wallet signs locally. Soltastic Gateway should never receive the user's private key.

---

## 6. Install Solana CLI

Solana CLI is useful for devnet testing, creating gateway keypairs, checking balances, and funding test accounts.

### macOS / Linux

Install Solana CLI using the official Solana installation method.

After installation, check:

```bash
solana --version
```

Set devnet:

```bash
solana config set --url devnet
solana config get
```

### Windows

Use one of these options:

1. Use WSL2 Ubuntu and follow the Linux instructions.
2. Use Solana's Windows-compatible installation method if available.
3. Use a Linux/macOS machine for gateway development if Windows setup becomes difficult.

Recommended for most Windows users: WSL2 Ubuntu.

---

## 7. Clone the repository

```bash
git clone https://github.com/kir3d/soltastic.git
cd soltastic
```

Check files:

```bash
ls
```

On Windows PowerShell:

```powershell
dir
```

---

## 8. Install project dependencies

From the repository root:

```bash
npm install
```

If the repository uses a separate server folder, use:

```bash
cd server
npm install
```

Then return to the project root if needed:

```bash
cd ..
```

If you see dependency audit warnings from Solana JavaScript packages, do not run this blindly:

```bash
npm audit fix --force
```

Forced audit fixes can install incompatible package versions.

---

## 9. Create the gateway keypair

The Soltastic Gateway needs a server payer keypair for devnet operations such as Durable Nonce account creation.

From the project root:

```bash
mkdir -p keys
solana-keygen new --outfile keys/server-payer.json
```

Show the public key:

```bash
solana-keygen pubkey keys/server-payer.json
```

Fund it on devnet:

```bash
solana config set --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/server-payer.json)
```

Check balance:

```bash
solana balance $(solana-keygen pubkey keys/server-payer.json)
```

### Windows PowerShell variant

PowerShell does not support the same `$()` syntax in all cases.

Use:

```powershell
$pubkey = solana-keygen pubkey keys/server-payer.json
solana config set --url devnet
solana airdrop 2 $pubkey
solana balance $pubkey
```

### Security warning

Never commit real keypairs.

Make sure these are ignored by Git:

```text
keys/
*.json
.env
```

---

## 10. Create `.env`

Create a `.env` file in the folder where the gateway server expects it.

Usually this is the project root or the `server/` folder.

Example:

```bash
PORT=8787
SOLANA_RPC_URL=https://api.devnet.solana.com

# Relative path to gateway keypair
SERVER_KEYPAIR=keys/server-payer.json

# Minimum client SOL balance required by the prototype
MIN_SOL=0.002

# Devnet USDC mint used by the prototype
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# Nonce session lifetime
NONCE_COOLDOWN_SECONDS=3600
```

If your server runs from the `server/` folder and the keypair is in the repository root, adjust the path:

```bash
SERVER_KEYPAIR=../keys/server-payer.json
```

---

## 11. Run local web version + gateway server

From the folder that contains `package.json`:

```bash
npm run dev
```

Expected result:

- backend server starts, usually on port `8787`;
- Vite web client starts, usually on port `5173`;
- browser opens or you can open it manually.

Open:

```text
http://localhost:5173/
```

Use `localhost` for Web Bluetooth.

Do not open the page through a random LAN IP unless your browser allows Bluetooth in that context.

---

## 12. Local web demo flow

1. Start the Soltastic gateway/server with `npm run dev`.
2. Open `http://localhost:5173/`.
3. Connect your Solana wallet.
4. Connect the Meshtastic BLE node.
5. Make sure the gateway Meshtastic node is online and on the same channel.
6. Send init:

```text
ST,init,<wallet>
```

7. Wait for balances and Durable Nonce data.
8. Enter receiver address, token, and amount.
9. Sign transaction locally in the wallet.
10. Send transaction data through the mesh.
11. Wait for the gateway to submit to Solana devnet.
12. Copy or open the confirmed transaction signature.

Successful end state:

```text
Confirmed on Solana
```

Important:

```text
Sent over mesh != confirmed on Solana
```

---

## 13. Run on macOS

Summary:

```bash
xcode-select --install
brew install git node
git clone https://github.com/kir3d/soltastic.git
cd soltastic
npm install
mkdir -p keys
solana-keygen new --outfile keys/server-payer.json
solana config set --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/server-payer.json)
cp .env.example .env  # if .env.example exists
npm run dev
```

Then open:

```text
http://localhost:5173/
```

If Web Bluetooth does not show the device:

- use Chrome or Edge;
- check macOS Bluetooth permissions;
- disconnect the Meshtastic node from other apps;
- make sure the Meshtastic node has Bluetooth enabled.

---

## 14. Run on Linux

Summary for Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts

git clone https://github.com/kir3d/soltastic.git
cd soltastic
npm install

mkdir -p keys
solana-keygen new --outfile keys/server-payer.json
solana config set --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/server-payer.json)

npm run dev
```

Then open:

```text
http://localhost:5173/
```

Linux Bluetooth troubleshooting:

```bash
systemctl status bluetooth
```

If Bluetooth service is stopped:

```bash
sudo systemctl enable bluetooth
sudo systemctl start bluetooth
```

Your user may need access to Bluetooth devices depending on the distribution and browser sandbox.

If Web Bluetooth does not work reliably on Linux, test with another Chromium-based browser or use a different Meshtastic connection mode for gateway development.

---

## 15. Run on Windows

Recommended terminal:

- PowerShell;
- Windows Terminal;
- Git Bash.

Install tools:

```powershell
winget install --id Git.Git -e
winget install OpenJS.NodeJS.LTS
```

Check:

```powershell
git --version
node -v
npm -v
```

Clone:

```powershell
git clone https://github.com/kir3d/soltastic.git
cd soltastic
npm install
```

Create key folder:

```powershell
mkdir keys
solana-keygen new --outfile keys/server-payer.json
```

Fund devnet key:

```powershell
$pubkey = solana-keygen pubkey keys/server-payer.json
solana config set --url devnet
solana airdrop 2 $pubkey
solana balance $pubkey
```

Run:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173/
```

### Windows recommendation

If native Windows Solana or Android tooling becomes difficult, use:

- Windows for browser testing;
- WSL2 Ubuntu for server/Solana CLI work;
- Android Studio on Windows for APK building.

---

## 16. Android build prerequisites

The Android version requires a heavier setup than the local web version.

Install:

1. Android Studio.
2. Android SDK Platform.
3. Android SDK Build-Tools.
4. Android SDK Platform-Tools.
5. JDK used by Android Studio / Gradle.
6. NDK Side by side.
7. CMake.
8. LLDB.
9. USB driver for your Android phone if needed.

In Android Studio:

```text
Android Studio
  -> Settings / Preferences
  -> Languages & Frameworks
  -> Android SDK
  -> SDK Platforms
  -> install a recent Android platform

Android Studio
  -> Settings / Preferences
  -> Languages & Frameworks
  -> Android SDK
  -> SDK Tools
  -> install:
       - Android SDK Build-Tools
       - Android SDK Platform-Tools
       - Android SDK Command-line Tools
       - NDK (Side by side)
       - CMake
       - LLDB
```

The exact menu names may vary slightly between Android Studio versions and operating systems.

---

## 17. Android environment variables

### macOS / Linux

Find your Android SDK path.

Common paths:

```bash
~/Library/Android/sdk          # macOS
~/Android/Sdk                  # Linux
```

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

For Linux, use:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Reload shell:

```bash
source ~/.zshrc
```

or:

```bash
source ~/.bashrc
```

Check:

```bash
adb version
```

### Windows

Common SDK path:

```text
C:\Users\<your-user>\AppData\Local\Android\Sdk
```

Set environment variables:

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

Close and reopen PowerShell.

Check:

```powershell
adb version
```

---

## 18. Prepare Android phone

On the Android phone:

1. Open **Settings**.
2. Go to **About phone**.
3. Tap **Build number** 7 times to enable Developer Options.
4. Go to **Developer Options**.
5. Enable **USB debugging**.
6. Connect phone to computer by USB.
7. Accept the RSA debugging prompt on the phone.

Check from computer:

```bash
adb devices
```

Expected:

```text
List of devices attached
<device_id>    device
```

If you see:

```text
unauthorized
```

Unlock the phone and accept the USB debugging prompt.

---

## 19. Build Android APK

The exact commands depend on how the Android prototype is stored.

### Case A: Android project uses Expo / React Native

From the Android project folder:

```bash
npm install
npx expo prebuild --clean --platform android
cd android
./gradlew :app:assembleDebug
```

On Windows PowerShell:

```powershell
npm install
npx expo prebuild --clean --platform android
cd android
.\gradlew.bat :app:assembleDebug
```

APK output is usually here:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install on connected phone:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

If you are already inside the `android/` folder:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Case B: Android project already has native `android/` folder

From the Android project root:

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On Windows:

```powershell
cd android
.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

### Case C: Build release APK

Debug APK is better for testing.

For release:

```bash
cd android
./gradlew :app:assembleRelease
```

Output is usually:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Release builds may require signing configuration before installation or distribution.

---

## 20. Run Android version on phone

After installing the APK:

1. Open Soltastic Android app.
2. Give Bluetooth permissions if Android asks.
3. Give Location / Nearby Devices permission if Android asks.
4. Turn on Bluetooth.
5. Make sure the Meshtastic node is powered on.
6. Disconnect the Meshtastic node from other apps.
7. Connect the app to the Meshtastic node.
8. Connect or trigger the wallet signing flow.
9. Send init through the mesh.
10. Build and sign transaction.
11. Send transaction data through LoRa.
12. Wait for gateway response and Solana confirmation.

---

## 21. Android troubleshooting

### `No Android connected device found`

Check:

```bash
adb devices
```

If no device appears:

- try another USB cable;
- enable USB debugging;
- change USB mode to File Transfer;
- install OEM USB driver on Windows;
- restart adb:

```bash
adb kill-server
adb start-server
adb devices
```

### `ANDROID_HOME is not set`

Set `ANDROID_HOME` to your Android SDK path.

macOS:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

Linux:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
```

Windows:

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

### `SDK location not found`

Create `android/local.properties`:

macOS:

```text
sdk.dir=/Users/<your-user>/Library/Android/sdk
```

Linux:

```text
sdk.dir=/home/<your-user>/Android/Sdk
```

Windows:

```text
sdk.dir=C:\\Users\\<your-user>\\AppData\\Local\\Android\\Sdk
```

### `gradlew: no such file or directory`

You are probably not inside the native Android project folder.

Try:

```bash
ls
ls android
```

If there is no `android/` folder and this is an Expo project, run:

```bash
npx expo prebuild --platform android
```

### `assets/adaptive-icon.png` missing

Create the missing asset or update `app.json` / `app.config.js`.

Common expected files:

```text
assets/icon.png
assets/adaptive-icon.png
assets/favicon.png
```

### BLE device does not appear

Check:

- Meshtastic device is powered on;
- Bluetooth is enabled on the Meshtastic device;
- phone Bluetooth is enabled;
- node is not connected to another app;
- app has Bluetooth permissions;
- app has Nearby Devices permission on modern Android;
- location permission may be required on some Android versions.

---

## 22. Common Solana troubleshooting

### Devnet airdrop fails

Try again later or use a different devnet faucet.

Check network:

```bash
solana config get
```

Set devnet again:

```bash
solana config set --url devnet
```

### Wallet does not show devnet

Some wallets hide devnet behind developer settings.

Look for:

```text
Settings -> Developer Settings -> Network -> Devnet
```

If your wallet does not support devnet well, use a wallet that supports devnet testing.

### Transaction simulation fails with blockhash error

For Soltastic, the transaction should use the Durable Nonce value returned by the gateway.

If you see blockhash-related errors:

- request a new init;
- refresh the Durable Nonce session;
- make sure the client uses `nonce_value` as the transaction blockhash;
- make sure `nonceAdvance` is the first instruction;
- make sure the gateway reconstructs the exact same transaction.

---

## 23. Common Meshtastic troubleshooting

### Browser cannot connect to node

Check:

- use Chrome or Edge;
- open the app at `http://localhost:5173/`;
- Bluetooth is enabled on the computer;
- Meshtastic node is not connected to another client;
- Meshtastic Bluetooth is enabled;
- pairing mode is active if required.

### Messages are not received by gateway

Check:

- both nodes use the same LoRa region;
- both nodes use the same channel settings;
- both nodes are in radio range;
- channel slot `7` is configured for the prototype;
- gateway server is running;
- gateway Meshtastic connection is active;
- hop limit is not too low for your test topology.

### ACK timeout

ACK timeout does not always mean the transaction failed.

It can mean the radio-level acknowledgment was not received.

Always check gateway logs and final Solana confirmation status.

---

## 24. Safe testing rules

Use only devnet while developing.

Do not use real funds.

Do not commit:

```text
.env
keys/
*.json
```

Do not post private channel keys publicly.

Do not flood public Meshtastic channels.

Use private channels and low-frequency, user-initiated tests.

---

## 25. Minimal successful test checklist

Before recording a demo, confirm:

- [ ] Git installed.
- [ ] Node.js LTS installed.
- [ ] Repository cloned.
- [ ] Dependencies installed.
- [ ] `.env` created.
- [ ] Gateway keypair created.
- [ ] Gateway keypair funded on devnet.
- [ ] Meshtastic client node configured.
- [ ] Meshtastic gateway node configured.
- [ ] Browser can connect to client Meshtastic node.
- [ ] Gateway can receive mesh messages.
- [ ] Wallet can sign on devnet.
- [ ] `ST,init,<wallet>` returns balances and nonce data.
- [ ] Transaction can be signed locally.
- [ ] Gateway submits transaction to Solana devnet.
- [ ] Client receives confirmed transaction signature.

For Android demo also confirm:

- [ ] Android Studio installed.
- [ ] JDK / SDK / NDK / CMake installed.
- [ ] `ANDROID_HOME` set.
- [ ] `adb devices` shows the phone.
- [ ] APK builds successfully.
- [ ] APK installs on the phone.
- [ ] Android app can connect to Meshtastic over BLE.


---

## Recommended companion docs:

```text
docs/
├── architecture.md
├── protocol.md
├── setup-and-run.md
├── android.md
└── security.md
```


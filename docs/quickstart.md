# Soltastic Quickstart

This guide explains how to run Soltastic on **Solana devnet** using:

- a server connected to one Meshtastic node over Bluetooth;
- an Android phone connected to another Meshtastic node over Bluetooth;
- a Solana wallet such as Phantom or Solflare.

Soltastic sends Solana transaction requests through a Meshtastic mesh network and uses a server with internet access to submit the finalized transaction to a Solana RPC node.

---

## Requirements

This quickstart has been tested on **macOS**.  
The examples below use macOS or Linux shell commands.

### Hardware

- A computer with Bluetooth.
- Two Meshtastic nodes with Bluetooth support.
- An Android smartphone with developer mode enabled.

### Software

- Node.js installed.
- Solana CLI installed.
- Android development tools installed.
- Phantom or Solflare wallet installed on the Android smartphone.


---

## 1. Configure both Meshtastic nodes

Before configuring Soltastic, check the settings used by your local Meshtastic network.

Make sure both Meshtastic nodes use the correct local settings, such as:

- region;
- frequency band, for example 433 MHz, 868 MHz, or 915 MHz;
- LoRa preset;
- modem settings used by your local mesh.

You can use the Meshtastic web client:

https://client.meshtastic.org/

On **both Meshtastic nodes** setup private channel:

1. Open **Channels**.
2. Select **Ch 7**.
3. Set **Role** to:

```text
SECONDARY
```

4. Set **Name** to:

```text
soltastic
```

5. Set **Pre-Shared Key** to:

```text
SkhITWNmZVdUM0d5TXlaeA==
```

Save the settings and reboot the devices if required.

> Note: the encrypted Soltastic channel is used to separate Soltastic traffic from public chat channels and avoid interfering with normal Meshtastic communication. The key is published here so anyone can join the channel and run their own Soltastic client or server.

---

## 2. Clone the repository

```bash
git clone https://github.com/kir3d/soltastic
cd soltastic
```

---

## 3. Build and install the Android app

Go to the mobile client folder:

```bash
cd soltastic-mobile-android
```

Install dependencies:

```bash
npm install
npx expo install expo-clipboard expo-navigation-bar @react-native-async-storage/async-storage @expo/vector-icons
```

Connect your Android phone to the computer with USB.

On the phone:

1. Enable developer mode.
2. Enable USB debugging.
3. Turn off Wi-Fi.
4. Turn on Bluetooth.
5. Make sure the phone is unlocked.

Check that the phone is visible through ADB:

```bash
adb devices -l
```

Build the Android app:

```bash
npx expo prebuild --clean --platform android
./build-apk.sh
```

If a previous version of the app is installed, remove it:

```bash
adb uninstall com.soltastic.app
```

Install the new APK:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Approve the installation on the phone if Android asks for confirmation.

---

## 4. Prepare the server

Open a new terminal window.

From the repository root, go to the server folder:

```bash
cd soltastic/server
```

Create the environment file:

```bash
mv .env.example .env
```

Create the server keypair:

```bash
mkdir -p keys
solana-keygen new --outfile keys/server-payer.json
```

Show the server public key:

```bash
solana-keygen pubkey keys/server-payer.json
```

Request **devnet 5 SOL** for this public key using the Solana faucet:

https://faucet.solana.com/


Install server dependencies:

```bash
npm install
```

Start the server:

```bash
npm run dev
```

Now connect the Meshtastic node to the server computer over Bluetooth.

When connected, the server is ready and listens for Soltastic requests on **Meshtastic channel 7**.

---

## 5. Prepare the sender wallet

On the Android phone:

1. Open Phantom or Solflare.
2. Switch the wallet network to **Solana devnet**.
3. Copy the sender wallet address.
4. Request about **5 SOL** for this address from:

https://faucet.solana.com/

Make sure the wallet shows the devnet SOL balance before continuing.

---

## 6. Send a transaction through Soltastic

On the Android phone:

1. Open the Soltastic app.
2. Connect the wallet.
3. Connect the second Meshtastic node over Bluetooth.
4. Wait for the automatic balance request.

After the app receives the server response, it should show:

- SOL balance;
- USDC balance, if available;
- durable nonce data prepared by the server.

Then:

1. Enter the receiver **address**, or scan a QR code.
2. Enter the **amount**.
3. Tap **Send**.
4. **Confirm** the transaction in the wallet.

The app sends the signed transaction data through Meshtastic.

The server then:

1. rebuilds the transaction;
2. verifies the signature;
3. submits it to the Solana RPC node;
4. waits for confirmation;
5. sends the transaction hash back through Meshtastic.

After a successful transaction, the app displays the **TX Hash**.

You can check it on Solscan:

https://solscan.io/

Make sure Solscan is set to **devnet**.

---

## Troubleshooting

### `SERVER_KEYPAIR is required`

Make sure `.env` exists and contains the correct path to the server keypair.

Example:

```env
SERVER_KEYPAIR=keys/server-payer.json
```

Then restart the server:

```bash
npm run dev
```

### Phone is not visible in ADB

Run:

```bash
adb devices -l
```

If the device is not listed:

- reconnect the USB cable;
- unlock the phone;
- approve the USB debugging prompt;
- make sure USB debugging is enabled;
- try another USB cable or port.

### Bluetooth connection fails

Check that:

- Bluetooth is enabled on the computer and phone;
- the Meshtastic nodes are powered on;
- the nodes are not already connected to another app;
- the Soltastic channel exists on both nodes;
- both nodes use the same local Meshtastic network settings.

### No response from server

Check that:

- the server is running;
- the server Meshtastic node is connected over Bluetooth;
- both nodes are on the same Meshtastic channel 7;
- both nodes use the same `soltastic` channel name and PSK;
- the server keypair has devnet SOL;
- the sender wallet has devnet SOL.

---

## Expected flow

```text
Android app + wallet
        |
        | Bluetooth
        v
Meshtastic node
        |
        | Mesh / LoRa, channel 7
        v
Meshtastic node
        |
        | Bluetooth
        v
Soltastic server
        |
        | Internet
        v
Solana devnet RPC
```

The final result is a confirmed Solana devnet transaction, with the transaction hash returned back to the Android app through the Meshtastic network.

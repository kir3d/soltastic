# Soltastic Mobile Android

Android-first React Native / Expo client for Soltastic.

The screen is split vertically:

- top pane: wallet connect, Meshtastic BLE connect, Init / balances / token / receiver / amount / Send
- bottom pane: logs

## Why this is a separate app

The browser client uses Web Bluetooth and browser wallet providers. Android needs native BLE and Mobile Wallet Adapter instead.

This version keeps the same Soltastic mesh protocol:

```text
ST,init,<wallet>
ST,<receiver>,<token>,<amount>,<signature>
```

## Requirements

- Node.js 20.19+
- Android Studio + Android SDK
- Android phone or emulator
- MWA-compatible Solana wallet on the Android device
- Meshtastic node with Bluetooth enabled
- Soltastic server listening on channel slot 7

Expo Go is not enough because BLE and Mobile Wallet Adapter require native modules. Use a custom development build.

## Install

From repo root:

```bash
cp -R soltastic-mobile-android mobile
cd mobile
npm install
```

## Run Android

```bash
npm run android
```

or explicitly:

```bash
npx expo prebuild --platform android
npx expo run:android
```

## Main files

```text
App.tsx
src/mesh/MeshtasticBleTransport.ts
src/mesh/MeshClient.ts
src/wallet/mobileWallet.ts
src/solana/transactions.ts
src/protocol/parse.ts
src/constants.ts
```

## Flow

1. Connect wallet.
2. Connect Meshtastic BLE node.
3. Press Init.
4. Wait for server response with SOL, USDC, durable nonce and fee address.
5. Select SOL or USDC.
6. Enter receiver and amount.
7. Press Send.
8. Wallet signs the durable nonce transaction.
9. App sends only the signature packet over Meshtastic.
10. Server broadcasts to Solana and returns confirmed `tx_hash`.
11. App resets back to Init because a fresh durable nonce is required.

## Notes

- The app signs transactions locally through Mobile Wallet Adapter.
- Private keys never go to the server.
- `src/mesh/MeshtasticBleTransport.ts` implements native Android BLE transport compatible with `@meshtastic/core` by exposing `ReadableStream` and `WritableStream`.
- If Android scan cannot find the node, make sure the Meshtastic node is not already connected to another phone/app.
- If the app connects but does not receive messages, confirm that the node channel settings match the server node and that both use the same slot/channel configuration.

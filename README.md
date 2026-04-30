<div align="center">
<img src="assets/logo.png" alt="Soltastic" width="100%" />

# Soltastic
**Solana transactions when mobile internet down.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF)](#why-solana)
[![Meshtastic](https://img.shields.io/badge/Meshtastic-LoRa-14F195)](#)

</div>

The project contains two parts:

- **Client** - a local browser application, a bridge between the wallet and the Meshtastic BLE node.
- **Server** - A relay server application that listens on the Meshtastic channel and communicates with Solana RPC nodes for client requests.

> Current prototype: Client initiates transaction; Server verifies balances and sends Durable Nonce to Client; Client creates and signs transaction; Server transmits to Solana network via RPC node.

---

## Problem

**Mobile connectivity failures create direct financial losses.**
When internet access fails, users lose the ability to move value, accept payments, execute transactions, or react to urgent financial events.

Sky Business research shows that UK SMEs affected by running out of mobile data lose over **£3,400 per year on average** in missed revenue, with **56%** of affected businesses reporting lost sales, bookings, or opportunities. [Sky Group](https://skygroup.sky/article/fear-of-running-out-of-mobile-data-foro-is-a-real-issue-for-uk-businesses-as-companies-lose-over-3-400-a-year)

In remote areas, disaster zones, fieldwork, crowded festivals, network outages, or censorship-resistant environments, this problem becomes even more important. A user may still have a wallet and a signed Solana transaction, but no internet connection to broadcast it.


---

## Solution

Soltastic is not just another wallet feature — it is a decentralized last-mile communication layer for blockchain transactions.
Using local LoRa-based mesh networks as the last mile, a relay server for transmitting RPC nodes to Solana, and deferred transaction technology.

[World Map](https://meshmap.net/)

---

## Why Solana

**Soltastic** was created for Solana because the network's properties support Deferred Execution based on **Durable Nonces**:

- **no expiration** — Deferred Execution do not require Blockhash, allowing transactions to exist for more than 2 minutes (150 blocks).
- **no double-spending** — an account's Advanced Nonce value changes after use, preventing double-spending.
- **mobile and wallet ecosystem** — Solana wallets can sign transactions on the client side without revealing private keys to a relayer and not delegating assets.

---

## Demo

Add demo assets before hackathon submission:

- **Live demo:** `https://<your-github-pages-or-demo-url>`
- **Video walkthrough:** `https://<your-video-url>`
- **Screenshots:** put images in `assets/` and reference them below.

Example:

```md
![Soltastic client](assets/client-screenshot.png)
![Soltastic server](assets/server-screenshot.png)
```

---

## Architecture

<img src="assets/architecture.svg" alt="Architecture" width="100%">

> [!IMPORTANT]
> **Privacy First:** The server never receives the user's private key. All signing happens locally on the client device.
    
---

## Protocol

### Init request

```text
ST,init,<wallet_address>
```

Example:

```text
ST,init,BX64tYBofmJM6PTWXtHjA8p8ij5dnzsqLXbgddaVmkom
```

### Successful response

```text
ST,S=<balance_sol>,C=<balance_usdc>,a=<nonce_account>,v=<nonce_value>.p=<fee_address>
```

Fields:

| Field | Meaning |
|---|---|
| `S` | SOL balance |
| `C` | USDC balance |
| `a` | durable nonce account address |
| `v` | durable nonce value |

### Low SOL response

```text
ST,S=<balance_sol>,C=<balance_usdc>,e=1
```

### Error response

```text
ST,S=0,C=0,e=2
```



## Repository Structure

Recommended clean structure:

```text
soltastic/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── assets/
├── docs/
├── client/
└── server/
```



## Quick Start

### 0. Meshtastic settings:

On the meshtastic node, you need to configure channel 7 slot with the private key *** and disconnect the phone from the node so that the computer can connect to the node later.

### 1. Install dependencies

```bash
npm install
nvm use 22
```

### 2. Create server payer keypair

```bash
mkdir -p keys
solana-keygen new --outfile keys/server-payer.json
```

For devnet testing:

```bash
solana config set --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/server-payer.json)
```

or transfer some SOL on the testnet to this address:

```bash
solana-keygen pubkey keys/server-payer.json
```

Check balance:

```bash
solana balance $(solana-keygen pubkey keys/server-payer.json)
```

### 3. Configure environment

Create `.env`:

```env
PORT=8787
SOLANA_RPC_URL=https://api.devnet.solana.com

# relative path to server keys
SERVER_KEYPAIR=keys/server-payer.json

# minimum client balance
MIN_SOL=0.002

# USDS smart contract address on the testnet
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# client response time
NONCE_COOLDOWN_SECONDS=3600
```

### 4. Run server + browser UI

```bash
npm run dev
```

The app opens at:

```text
http://localhost:5173/
```

Use `localhost` for Web Bluetooth support.

---

Never commit real keypairs.

---


## Development Commands

```bash
npm run dev      # run backend + Vite UI
npm audit --omit=dev
```

Known dependency note: Solana JS SDK v1 may currently produce moderate `npm audit` warnings through transitive dependencies. Do not run `npm audit fix --force` blindly because it can install incompatible old Solana packages.

---

## Roadmap

- [x] Meshtastic BLE connection
- [x] Monitor Meshtastic channel slot `7`
- [x] Parse `ST,init,<wallet>` messages
- [x] Check SOL and USDC balances
- [x] Create durable nonce account
- [x] Reply with nonce account and nonce value
- [ ] Client-side durable nonce transaction builder
- [ ] Signed transaction transfer over Meshtastic
- [ ] Server-side signed transaction submission to Solana RPC
- [ ] Server payment distribution design
- [ ] Demo video / GIF
- [ ] Docs: architecture, API, product, roadmap

---

## Contributing

Contributions are welcome. Suggested flow:

1. Fork the repository.
2. Create a feature branch:

   ```bash
   git checkout -b feat/my-feature
   ```

3. Commit with a meaningful message:

   ```bash
   git commit -m "feat: add signed init verification"
   ```

4. Open a pull request.

Please avoid committing real private keys, `.json` and `.env` files, generated build artifacts, or temporary files.


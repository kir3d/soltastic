<div align="center">
<img src="assets/logo.png" alt="Soltastic" width="100%" />

# Soltastic
**Solana transactions when mobile internet down.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF)](#why-solana)
[![Meshtastic](https://img.shields.io/badge/Meshtastic-LoRa-14F195)](#)

</div>

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

The project contains two parts:

- **Client** - a local browser application, a bridge between the wallet and the Meshtastic BLE node.
- **Server** - A relay server application that listens on the Meshtastic channel and communicates with Solana RPC nodes for client requests.

<img src="assets/architecture.svg" alt="Architecture" width="100%">

> [!IMPORTANT]
> **Privacy First:** The server never receives the user's private key. All signing happens locally on the client device.
    
---

## Protocol

Soltastic uses short comma-separated text messages so they can fit into Meshtastic payloads.

Current Meshtastic settings:

- Channel slot: `7`
- Destination: broadcast, `0xffffffff`
- Message prefix: `ST`

The protocol has two stages:

1. Init request — the client asks the server to prepare a durable nonce.
2. Transaction request — the client signs locally and sends only the transaction parameters plus the sender signature through the mesh.

The server never receives the user's private key. Signing happens locally in the user's wallet.

---

### 1. Init request

Client → Meshtastic → Server:

```text
ST,init,<wallet_address>
```

Example:

```text
ST,init,BX64tYBofmJM6PTWXtHjA8p8ij5dnzsqLXbgddaVmkom
```

Fields:

| Field | Meaning |
|---|---|
| `ST` | Soltastic protocol prefix |
| `init` | Init command |
| `<wallet_address>` | User's Solana wallet address |

---

### 2. Init response

Server → Meshtastic → Client:

```text
ST,S=<balance_sol>,C=<balance_usdc>,a=<nonce_account>,v=<nonce_value>,p=<server_fee_address>
```

Example:

```text
ST,S=1.23456789,C=25.5,a=GBaiLdo36MkYfcrASC4ispbCGjDuKAJPnXDCCNv1kzyo,v=AxEQhxUf4Z9GSu6KGbSktrUCRwSFtKYUjeYJXuR87jfK,p=29ySgo67m9GJTGgJ111MDwvpfGPkUboUX9wk9My47ync
```

Fields:

| Field | Meaning |
|---|---|
| `S` | User's SOL balance |
| `C` | User's USDC balance |
| `a` | Durable nonce account address |
| `v` | Durable nonce value used as the transaction blockhash |
| `p` | Server fee address |

After this response, the client can build a durable nonce transaction locally.

---

### 3. Client-side transaction construction

The client builds the transaction locally with:

1. `nonceAdvance` as the first instruction.
2. Optional compute budget instructions.
3. User transfer instruction:
   - SOL transfer, or
   - USDC SPL token transfer.
4. Service fee transfer to the server fee address.
5. `nonceAuthorize`, transferring nonce authority to the server fee address.

The transaction is signed locally by the user's wallet.

Only the sender signature is sent over Meshtastic.

---

### 4. Transaction request

Client → Meshtastic → Server:

```text
ST,<receiver>,<token>,<amount>,<signature>
```

Example SOL transfer:

```text
ST,9xQeWvG816bUx9EPjHmaT23yvVM2ZWp9W5LrYZKqKxY,SOL,0.01,5Yp...
```

Example USDC transfer:

```text
ST,9xQeWvG816bUx9EPjHmaT23yvVM2ZWp9W5LrYZKqKxY,USDC,2.5,5Yp...
```

Fields:

| Field | Meaning |
|---|---|
| `ST` | Soltastic protocol prefix |
| `<receiver>` | Receiver Solana address |
| `<token>` | Token symbol: `SOL` or `USDC` |
| `<amount>` | Human-readable transfer amount |
| `<signature>` | Base58 sender signature from the locally signed transaction |

The server uses the previous init state for the mesh sender, reconstructs the same transaction, verifies the signature, submits the transaction to Solana RPC, and waits for confirmation.

---

### 5. Successful transaction response

Server → Meshtastic → Client:

```text
ST,<tx_hash>
```

Example:

```text
ST,3NuhRY8oU7kJ5xZrWq5Q1q4E9v9fY7Kj9Yd5rR2LqN4wVvYdEJZJr9uC6Q7a8...
```

Fields:

| Field | Meaning |
|---|---|
| `ST` | Soltastic protocol prefix |
| `<tx_hash>` | Confirmed Solana transaction signature |

---

### 6. Error responses

Server → Meshtastic → Client:

```text
ST,S=<balance_sol>,C=<balance_usdc>,e=<error_code>
```

or:

```text
ST,e=<error_code>
```

Error codes:

| Code | Meaning |
|---|---|
| `1` | Client SOL balance is below the required minimum |
| `2` | Init/backend error |
| `3` | Server failed to submit the transaction |
| `4` | Server does not know the mesh sender; init is required |
| `5` | Nonce was not found or expired |
| `6` | Invalid client signature |
| `7` | Transaction was not confirmed or timed out |
| `8` | Transaction failed on-chain |

---

### Message flow

```text
Client Wallet
   |
   | 1. ST,init,<wallet>
   v
Meshtastic Mesh
   |
   v
Server
   |
   | 2. ST,S=<SOL>,C=<USDC>,a=<nonce_account>,v=<nonce_value>,p=<fee_address>
   v
Client Wallet
   |
   | 3. Build durable nonce transaction locally
   | 4. Sign transaction locally
   |
   | 5. ST,<receiver>,<token>,<amount>,<signature>
   v
Meshtastic Mesh
   |
   v
Server
   |
   | 6. Rebuild transaction
   | 7. Verify signature
   | 8. Submit to Solana RPC
   |
   | 9. ST,<tx_hash>
   v
Client Wallet
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

- [x] Basic version (init request, get balance, create SOL transaction, send metadata + signatures, recreate transaction, send to RPC, confirm tx hash to client)
- [ ] Connecting Meshtastic nodes via serial and WiFi, exploring the possibility of connecting to MeshMonitor
- [ ] Add support for other tokens
- [ ] Add support for memos
- [ ] Add support for other transaction types (calling smart contracts)

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


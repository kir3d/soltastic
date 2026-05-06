# Soltastic Protocol

Soltastic uses Meshtastic / LoRa as a low-bandwidth transport layer for signed Solana transactions.

This document describes the current prototype protocol and the planned binary protocol direction.

---

## Protocol goals

Soltastic protocol is designed around five goals:

1. Keep LoRa messages compact.
2. Never expose the user's private key.
3. Use Solana as the only settlement layer.
4. Treat mesh delivery as transport, not finality.
5. Return a confirmed Solana transaction signature to the client.

Soltastic is not a blockchain, token, validator network, mining system, or offline consensus protocol.

> Meshtastic is not the blockchain. It is the radio courier.

---

## Current prototype status

The current prototype uses a short text protocol for easier debugging.

This format is temporary. The production direction is a compact binary payload sent through a private Meshtastic application port.

Current prototype settings:

| Setting | Value |
|---|---|
| Message prefix | `ST` |
| Meshtastic channel slot | `7` |
| Transport | Meshtastic text message |
| Solana network | Devnet |
| Settlement | Solana confirmation |
| Finality source | Solana, not mesh delivery |

---

## Actors

### Client

The client is the user-facing application.

It can be either:

- local browser version;
- Android smartphone version.

The client is responsible for:

- connecting to the user's Solana wallet;
- connecting to a Meshtastic node;
- sending init requests;
- receiving nonce/session data;
- building the Solana transaction locally;
- asking the wallet to sign;
- sending transaction data over the mesh;
- displaying final status and confirmed transaction signature.

The client never sends a private key.

### Mesh Gateway

The Mesh Gateway is an internet-connected relay node.

It is responsible for:

- receiving Soltastic messages over Meshtastic;
- mapping mesh sender IDs to wallet sessions;
- checking wallet balances;
- creating or preparing Durable Nonce state;
- reconstructing the expected transaction;
- verifying the wallet signature;
- submitting the transaction to Solana RPC;
- waiting for confirmation;
- returning the result over the mesh.

The gateway is not a Solana validator and does not provide consensus.

---

## Transaction lifecycle

```text
1. Client connects wallet
2. Client connects Meshtastic node
3. Client sends init request over mesh
4. Gateway checks wallet and prepares Durable Nonce
5. Gateway replies with balance + nonce data
6. Client builds transaction locally
7. Wallet signs transaction locally
8. Client sends signed transaction data over mesh
9. Gateway reconstructs and verifies the transaction
10. Gateway submits transaction to Solana RPC
11. Gateway waits for confirmation
12. Gateway returns confirmed tx signature over mesh
```

A transaction is complete only after Solana confirms it.

Mesh delivery alone is not settlement.

---

## Current text protocol

All current prototype messages use the `ST` prefix.

Messages are comma-separated UTF-8 text messages.

### 1. Init request

Sent by the client to the gateway.

```text
ST,init,<wallet_address>
```

Example:

```text
ST,init,BX64tYBofmJM6PTWXtHjA8p8ij5dnzsqLXbgddaVmkom
```

Fields:

| Field | Description |
|---|---|
| `ST` | Soltastic protocol prefix |
| `init` | Init request type |
| `<wallet_address>` | User's Solana wallet public key in base58 |

Purpose:

- identifies the user's wallet;
- lets the gateway check balances;
- starts or refreshes the mesh sender ↔ wallet session;
- asks the gateway to prepare Durable Nonce data.

---

### 2. Init success response

Sent by the gateway to the client.

```text
ST,S=<balance_sol>,C=<balance_usdc>,a=<nonce_account>,v=<nonce_value>,p=<server_fee_address>
```

Example:

```text
ST,S=1.2345,C=25.5,a=GBaiLdo36MkYfcrASC4ispbCGjDuKAJPnXDCCNv1kzyo,v=AxEQhxUf4Z9GSu6KGbSktrUCRwSFtKYUjeYJXuR87jfK,p=29ySgo67m9GJTGgJ111MDwvpfGPkUboUX9wk9My47ync
```

Fields:

| Field | Description |
|---|---|
| `S` | User SOL balance |
| `C` | User USDC balance |
| `a` | Durable Nonce account address |
| `v` | Durable Nonce value |
| `p` | Gateway service fee public key |

Purpose:

- gives the client enough data to build a Durable Nonce transaction;
- tells the client where the gateway fee should be paid;
- allows the user interface to display available balances.

---

### 3. Low balance response

Sent by the gateway when the wallet does not have enough SOL for the flow.

```text
ST,S=<balance_sol>,C=<balance_usdc>,e=1
```

Example:

```text
ST,S=0.0004,C=0,e=1
```

Meaning:

- the wallet was recognized;
- balances were checked;
- SOL balance is below the required minimum;
- client should not continue to transaction signing.

---

### 4. Transaction request

Sent by the client to the gateway after local wallet signing.

Current prototype format:

```text
ST,<receiver>,<token>,<amount>,<signature>
```

Example:

```text
ST,9xQeWvG816bUx9EPjHmaT23yvVM2ZWp9W5LrYZKqKxY,SOL,0.01,5Yp...
```

Fields:

| Field | Description |
|---|---|
| `ST` | Soltastic protocol prefix |
| `<receiver>` | Receiver Solana address |
| `<token>` | Token symbol, for example `SOL` or `USDC` |
| `<amount>` | Transfer amount as a decimal string |
| `<signature>` | User wallet signature |

Gateway behavior:

1. find the wallet session for the mesh sender;
2. load nonce account and nonce value from session;
3. reconstruct the exact expected transaction;
4. verify the provided signature;
5. submit the transaction to Solana RPC;
6. wait for confirmation;
7. return success or error response.

---

### 5. Success response

Sent by the gateway after Solana confirmation.

```text
ST,<tx_hash>
```

Example:

```text
ST,4xQeWvG816bUx9EPjHmaT23yvVM2ZWp9W5LrYZKqKxYk7n2...
```

The client should display this as the final confirmed transaction signature.

---

### 6. Error response

Sent by the gateway if the transaction cannot be completed.

```text
ST,e=<error_code>
```

Example:

```text
ST,e=6
```

Error codes:

| Code | Meaning |
|---|---|
| `1` | Client SOL balance is below the required minimum |
| `2` | Init or backend error |
| `3` | Gateway failed to submit the transaction |
| `4` | Gateway does not know this mesh sender; init is required |
| `5` | Durable Nonce was not found, expired, or unavailable |
| `6` | Invalid client signature |
| `7` | Transaction was not confirmed or confirmation timed out |
| `8` | Transaction failed on-chain |

---

## Durable Nonce requirements

The Solana transaction must use the Durable Nonce value returned by the gateway.

The transaction should include:

1. `nonceAdvance` as the first instruction;
2. optional compute budget instructions;
3. user transfer instruction;
4. gateway service fee instruction;
5. any cleanup or nonce lifecycle instructions required by the current implementation.

Important rules:

- the client signs locally;
- the gateway must reconstruct the exact transaction;
- the gateway must reject signatures that do not match the reconstructed transaction;
- the transaction is not final until confirmed by Solana;
- stale nonce state must result in an explicit error.

---

## Session model

The gateway stores a short-lived mapping:

```text
mesh_sender_id -> wallet_address -> nonce_session
```

The session may include:

| Field | Description |
|---|---|
| `mesh_sender_id` | Meshtastic sender node ID |
| `wallet_address` | User Solana wallet address |
| `nonce_account` | Durable Nonce account address |
| `nonce_value` | Durable Nonce value |
| `server_fee_address` | Gateway fee receiver |
| `created_at` | Session creation time |
| `expires_at` | Session expiration time |

If a transaction request arrives without a known session, the gateway returns:

```text
ST,e=4
```

---

## Mesh delivery rules

Recommended prototype behavior:

- use a private Meshtastic channel;
- use channel slot `7` for the current prototype;
- keep hop limit conservative;
- send only user-initiated messages;
- do not continuously poll balances over mesh;
- do not broadcast mempool-like data;
- do not run blockchain sync over LoRa.

Soltastic should respect mesh bandwidth and avoid abusing public community channels.

---

## Security model

Soltastic assumes the mesh network is unreliable and potentially adversarial.

Security properties:

| Property | Approach |
|---|---|
| User key safety | Private key never leaves the wallet |
| Transaction integrity | Gateway verifies signature against reconstructed transaction |
| Replay protection | Durable Nonce semantics and session validation |
| Finality | Only Solana confirmation counts |
| Gateway trust minimization | Gateway can relay but cannot forge user transactions |
| Mesh safety | Compact, user-initiated messages only |

The gateway can refuse, delay, or fail to submit a transaction, but it cannot create a valid transaction that the user did not sign.

---

## Why text format is temporary

Text messages are easy to debug but inefficient over LoRa.

Examples:

| Data | Binary size | Text size |
|---|---:|---:|
| Solana public key | 32 bytes | about 44 base58 chars |
| Solana signature | 64 bytes | about 88 base58 chars |
| 180-byte raw transaction | 180 bytes | about 240 base64 chars |

This matters because LoRa payload capacity is small, and fragmentation reduces reliability.

The production protocol should move to binary payloads.

---

## Planned binary protocol

The binary protocol should be sent with Meshtastic `sendData()` using a private application port.

Goals:

- reduce airtime;
- reduce message size;
- reduce fragmentation;
- make packet parsing deterministic;
- support versioning;
- support future message types.

### Common header

Proposed common header:

```text
byte 0    protocol_version
byte 1    message_type
byte 2    flags
byte 3    reserved
```

Possible message types:

| Type | Name |
|---:|---|
| `0x01` | Init request |
| `0x02` | Init response |
| `0x03` | Transaction request |
| `0x04` | Transaction result |
| `0x05` | Error |
| `0x06` | Chunk |
| `0x07` | Ack |

---

### Binary init request

```text
byte 0       version
byte 1       type = 0x01
byte 2       flags
byte 3       reserved
bytes 4-35   wallet_pubkey
```

Total size:

```text
36 bytes
```

Compared to text:

```text
ST,init,<wallet_base58> ≈ 52 bytes
```

---

### Binary signed init request

Optional future format if signed init is required.

```text
byte 0        version
byte 1        type = 0x01
byte 2        flags
byte 3        reserved
bytes 4-35    wallet_pubkey
bytes 36-51   client_nonce
bytes 52-115  signature
```

Total size:

```text
116 bytes
```

---

### Binary init response

Possible compact format:

```text
byte 0        version
byte 1        type = 0x02
byte 2        flags
byte 3        reserved
bytes 4-11    sol_lamports_u64
bytes 12-19   usdc_amount_u64
bytes 20-51   nonce_account_pubkey
bytes 52-83   nonce_value_hash_or_pubkey
bytes 84-115  server_fee_pubkey
```

Note:

The exact representation of `nonce_value` must match the transaction-building requirements. If the full nonce value is required as a 32-byte hash, it should be stored directly.

---

### Binary transaction request

There are two possible directions.

#### Option A: compact transaction metadata + signature

```text
header
receiver_pubkey
token_id
amount_u64
signature
```

Pros:

- smaller payload;
- easier to fit into one packet;
- gateway can reconstruct exact transaction.

Cons:

- client and gateway must stay perfectly in sync on transaction construction rules.

#### Option B: raw signed transaction chunks

```text
header
tx_id
chunk_index
chunk_count
raw_transaction_bytes
```

Pros:

- gateway does not need to reconstruct as much;
- more general;
- supports more transaction types.

Cons:

- larger payload;
- requires chunking and reassembly;
- more packet loss risk.

Recommended near-term path:

1. keep metadata + signature for simple SOL / USDC transfers;
2. add chunking later for general raw Solana transactions.

---

## Versioning

Every binary payload should include a protocol version.

Recommended behavior:

- reject unsupported major versions;
- tolerate unknown optional flags;
- include explicit error codes for unsupported message types;
- document all breaking changes in this file.

---

## Finality rules

The client UI should clearly distinguish:

| State | Meaning |
|---|---|
| `sent_over_mesh` | Client transmitted the message |
| `received_by_gateway` | Gateway received or acknowledged the message |
| `submitted_to_rpc` | Gateway submitted transaction to Solana RPC |
| `confirmed_on_solana` | Transaction reached required confirmation |
| `failed` | Transaction failed or timed out |

Only `confirmed_on_solana` is final success.

---

## Non-goals

Soltastic protocol does not attempt to provide:

- offline blockchain consensus;
- local settlement finality;
- proof-of-work over LoRa;
- mining;
- mempool broadcast;
- general blockchain synchronization;
- high-frequency market data transport;
- replacement for Solana RPC;
- replacement for Meshtastic routing.

---

## Recommended companion docs:

```text
docs/
├── architecture.md
├── protocol.md
├── setup-and-run.md
└── security.md
```

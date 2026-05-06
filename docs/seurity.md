# Soltastic Security

Soltastic is an offline last-mile transaction relay for Solana.

It allows a user to sign a Solana transaction locally and send transaction data through a Meshtastic / LoRa mesh network to an internet-connected gateway. The gateway submits the transaction to Solana RPC and returns the confirmed transaction signature back over the mesh.

This document describes the security model, trust assumptions, risks, and production-readiness checklist.

---

## Security summary

Soltastic is designed around one core rule:

> The user's private key never leaves the user's wallet.

The Mesh Gateway can relay a transaction, but it should not be able to create or modify a valid user transaction without the user's signature.

Soltastic does not provide offline finality. A transaction is complete only when it is confirmed by Solana.

```text
Mesh delivery != Solana confirmation
```

---

## Current security status

Soltastic is currently a devnet prototype.

Do not use with real funds until:

- transaction construction is audited;
- signature verification is audited;
- Durable Nonce lifecycle is audited;
- gateway behavior is audited;
- Android signing flow is reviewed;
- binary protocol is implemented and reviewed;
- replay protection is tested;
- failure modes are tested;
- production monitoring is added.

---

## Main assets

| Asset | Why it matters |
|---|---|
| User private key | Must never leave the wallet |
| Signed transaction | Authorizes movement of user funds |
| Durable Nonce session | Enables delayed submission |
| Gateway keypair | Pays for gateway operations and may manage nonce accounts |
| Mesh channel configuration | Separates Soltastic traffic from public Meshtastic traffic |
| Transaction status | User must not confuse mesh delivery with on-chain confirmation |
| Gateway logs | May contain wallet addresses, mesh node IDs, tx hashes, and debugging data |

---

## Actors

### User

The user owns the wallet and approves transaction signing.

The user trusts:

- their wallet;
- their local device;
- the transaction information shown before signing.

The user should not need to trust the gateway with private keys.

### Client

The client is the Soltastic local web app or Android app.

It is responsible for:

- connecting to wallet;
- connecting to Meshtastic device;
- requesting nonce/session data;
- building the transaction locally;
- asking the wallet to sign;
- sending transaction data over mesh;
- displaying final status.

### Mesh Gateway

The gateway is an internet-connected relay.

It can:

- receive Soltastic mesh messages;
- prepare Durable Nonce data;
- reconstruct expected transactions;
- verify signatures;
- submit transactions to Solana RPC;
- return status over mesh.

It cannot:

- access user private keys;
- forge valid user transactions;
- turn mesh delivery into Solana finality.

### Mesh network

The Meshtastic network is treated as unreliable and potentially observable.

It may:

- drop packets;
- delay packets;
- duplicate packets;
- reorder packets;
- expose metadata;
- be congested;
- include unknown nodes.

### Solana network

Solana is the settlement layer.

Only Solana confirmation should be treated as final success.

---

## Trust boundaries

```text
┌──────────────────────────────┐
│ User device / wallet         │
│                              │
│ private key                  │
│ local signing approval       │
└──────────────┬───────────────┘
               │ signed transaction data
               ▼
┌──────────────────────────────┐
│ Meshtastic / LoRa mesh       │
│                              │
│ unreliable transport         │
│ possible observers           │
│ possible replay attempts     │
└──────────────┬───────────────┘
               │ signed payload
               ▼
┌──────────────────────────────┐
│ Soltastic Gateway            │
│                              │
│ relay + verification         │
│ no custody                   │
│ no user private key          │
└──────────────┬───────────────┘
               │ Solana RPC submission
               ▼
┌──────────────────────────────┐
│ Solana                       │
│                              │
│ execution                    │
│ confirmation                 │
│ settlement                   │
└──────────────────────────────┘
```

---

## Security goals

Soltastic should provide:

1. **Non-custodial signing** — the gateway never receives private keys.
2. **Transaction integrity** — the gateway submits only the transaction the user signed.
3. **Replay resistance** — old mesh messages should not create unintended new transfers.
4. **Clear finality** — success is shown only after Solana confirmation.
5. **Mesh safety** — Soltastic traffic must not abuse public mesh channels.
6. **Gateway accountability** — gateway behavior should be logged and observable.
7. **Failure transparency** — users should see clear errors for nonce expiration, invalid signatures, timeouts, and RPC failures.

---

## Non-goals

Soltastic does not attempt to provide:

- offline settlement finality;
- local LoRa consensus;
- proof-of-work;
- mining;
- new validator network;
- replacement for Solana RPC;
- blockchain synchronization over Meshtastic;
- high-frequency financial messaging over LoRa;
- privacy guarantees against all radio-level metadata observers.

---

## Key security principle

The gateway must always verify that the user signature matches the transaction that will be submitted.

Bad design:

```text
Client sends intent:
  "send 1 SOL to Alice"

Gateway builds any transaction it wants.
```

Better design:

```text
Client signs exact transaction message locally.

Gateway reconstructs the same transaction.
Gateway verifies the signature.
Gateway submits only if signature matches.
```

Best production direction:

```text
Client signs exact transaction locally.
Gateway verifies the signed transaction bytes.
Gateway submits exactly those bytes or rejects.
```

---

## Transaction finality model

| State | Meaning | Final? |
|---|---|---|
| `sent_over_mesh` | Client sent packet to radio | No |
| `received_by_gateway` | Gateway received packet | No |
| `submitted_to_rpc` | Gateway sent transaction to Solana RPC | No |
| `confirmed_on_solana` | Solana confirmed transaction | Yes |
| `failed` | Transaction failed or timed out | No |

The user should never see a mesh ACK as a successful payment.

---

## Durable Nonce security

Durable Nonce is central to Soltastic because the transaction may be signed before the gateway submits it.

| Risk | Description | Mitigation |
|---|---|---|
| Stale nonce | Nonce was already used or expired | Return explicit error and require re-init |
| Wrong nonce authority | Transaction cannot advance nonce or may fail | Verify nonce authority before signing/submission |
| Nonce mismatch | Client and gateway reconstruct different transactions | Gateway must verify exact signed message |
| Replay | Old mesh message is resent | Track nonce/session/tx IDs and reject duplicates |
| Rent/cleanup issue | Nonce accounts may leave funds locked | Explicit nonce lifecycle and cleanup flow |

Recommended rules:

- `nonceAdvance` must be the first instruction.
- Nonce value used by the client must match the gateway session.
- Each nonce session should have an expiration time.
- Gateway should mark nonce sessions as used after successful submission.
- Gateway should reject duplicate transaction IDs or used nonce sessions.
- Nonce account cleanup should be logged and monitored.

---

## Replay protection

Replay protection should be handled at several layers.

### Current prototype

The current prototype relies mainly on:

- Durable Nonce semantics;
- gateway session state;
- signature verification;
- Solana rejecting already-used nonce transactions.

### Recommended production additions

Add explicit fields:

```text
protocol_version
message_type
session_id
client_nonce
tx_id
created_at
expires_at
```

Gateway should store:

```text
tx_id -> status
session_id -> nonce state
used_nonce_value -> used
```

Gateway should reject:

- expired sessions;
- repeated `tx_id`;
- already-used nonce values;
- transaction requests from unknown mesh sender IDs;
- signatures that do not match the expected transaction.

---

## Mesh network risks

Meshtastic / LoRa is a low-bandwidth transport, not a secure payment settlement layer.

| Risk | Impact | Mitigation |
|---|---|---|
| Packet loss | Transaction request may not reach gateway | Retries, status tracking |
| Packet duplication | Gateway may process same request twice | Idempotency and tx IDs |
| Packet replay | Old payload may be resent | Nonce/session validation |
| Packet delay | User may see slow status | Clear timeouts |
| Packet observation | Metadata may be visible | Private channel, minimal metadata |
| Congestion | Poor delivery and community harm | Low traffic, private channel |
| Public channel misuse | Annoys community users | Dedicated Soltastic channel |
| Gateway impersonation | Fake gateway may reply | Gateway identity/signing roadmap |

---

## Published Soltastic channel key

For development and public interoperability, the Soltastic test channel key is published:

```text
Channel slot/index: 7
Channel name: soltastic
PSK Base64: SkhITWNmZVdUM0d5TXlaeA==
```

This encrypted channel is used to separate Soltastic traffic from public Meshtastic channels and avoid disturbing normal conversations.

Important:

- this key is public;
- anyone can join the test channel;
- it should not be treated as a secret;
- it does not authenticate a gateway;
- it does not make messages private from anyone who knows the key;
- it is useful for interoperability, not strong access control.

For private deployments, use a private PSK and do not publish it.

---

## Gateway risks

The gateway is powerful because it connects the mesh to Solana RPC.

### Gateway can fail safely

A gateway may:

- go offline;
- ignore requests;
- delay submission;
- return an error;
- fail to confirm a transaction.

These are availability failures.

### Gateway must not fail dangerously

A gateway must not be able to:

- steal user funds;
- change receiver address;
- change amount;
- change fee recipient;
- submit a different transaction than the user approved;
- mark a transaction as confirmed without checking Solana.

### Required gateway checks

Before submission, the gateway should verify:

- mesh sender has an active session;
- wallet address matches the session;
- Durable Nonce account matches the session;
- nonce value matches the signed transaction;
- transaction instructions match expected user intent;
- gateway fee instruction matches expected policy;
- signature is valid;
- transaction has not already been processed;
- transaction simulation result is acceptable if simulation is used.

---

## Gateway key management

The gateway may use a keypair for:

- paying transaction fees for gateway operations;
- creating Durable Nonce accounts;
- closing or cleaning up nonce accounts;
- receiving service fees.

Rules:

- keep gateway keypair out of Git;
- store keypair in a secure environment;
- use devnet keypairs for development only;
- rotate keys if exposed;
- separate development, staging, and production keys;
- keep `.env` and `keys/` out of commits;
- monitor gateway balances;
- never hardcode private keys in frontend or mobile code.

Recommended `.gitignore` entries:

```text
.env
.env.*
keys/
*.json
```

If a JSON file is needed for non-secret config, do not store it in the same path pattern as keypairs.

---

## Client-side risks

### Local web client

| Risk | Mitigation |
|---|---|
| Malicious browser extension | Use clean browser profile for testing |
| Wrong wallet network | Clearly show devnet/mainnet status |
| Confusing signing prompt | Show transaction summary before signing |
| BLE permission issues | Explain browser/BLE requirements |
| App served from wrong origin | Prefer localhost during development |
| Frontend supply chain risk | Lock dependencies and audit builds |

The local web client should show:

- wallet address;
- network;
- receiver address;
- token;
- amount;
- gateway fee;
- status;
- final tx signature.

### Android client

| Risk | Mitigation |
|---|---|
| BLE permission complexity | Request only required permissions |
| Background behavior limits | Do not assume background server behavior |
| Wallet signing flow confusion | Clear transaction preview |
| APK tampering | Use signed release builds for distribution |
| Device-specific BLE bugs | Test on multiple Android devices |
| Lost connectivity | Clear retry and timeout states |

Android production builds should be signed and distributed through a trusted channel.

---

## Transaction preview requirements

Before signing, the client should show the user:

| Field | Required |
|---|---|
| Sender wallet | Yes |
| Receiver address | Yes |
| Token | Yes |
| Amount | Yes |
| Gateway fee | Yes |
| Network | Yes |
| Nonce session status | Recommended |
| Estimated total cost | Recommended |
| Gateway identity | Recommended |
| Expiration / timeout | Recommended |

The user should be able to cancel before signing.

---

## Privacy considerations

Soltastic is not currently designed as a strong privacy protocol.

Potentially visible data:

- Meshtastic node IDs;
- timing of transactions;
- wallet addresses;
- receiver addresses;
- token and amount if sent as plaintext text protocol;
- transaction hashes;
- gateway identity;
- approximate radio topology.

Mitigations:

- use a private channel;
- move from text to binary payloads;
- avoid unnecessary fields;
- avoid logging sensitive payloads;
- rotate test wallets;
- allow private deployment-specific PSKs;
- consider payload encryption beyond Meshtastic channel encryption for production.

Important:

Published test PSK means test channel traffic should not be considered private.

---

## Logging policy

Gateway logs are useful for debugging but may leak sensitive data.

Development logs may include:

- wallet addresses;
- receiver addresses;
- amounts;
- signatures;
- raw transaction bytes;
- nonce accounts;
- tx hashes;
- mesh sender IDs.

Production logs should avoid storing:

- full raw transactions unless necessary;
- full signatures unless necessary;
- private keys;
- private channel keys;
- complete user activity history.

Recommended production logging:

- log tx hash;
- log gateway status;
- log error code;
- log shortened wallet addresses;
- log session ID;
- avoid full payload dumps by default;
- enable verbose logs only for debugging.

---

## Denial-of-service risks

Soltastic gateways may be attacked by spam requests.

| Risk | Mitigation |
|---|---|
| Mesh spam | Private channel, low hop limit, rate limits |
| Init spam | Per-node and per-wallet rate limits |
| Nonce account spam | Require minimum balance and cooldown |
| RPC spam | Queue and throttle submissions |
| Storage spam | Expire sessions and clean old state |
| Gateway balance drain | Limit nonce creation and fee policies |

Recommended gateway limits:

```text
max_init_per_node_per_hour
max_active_sessions_per_wallet
max_active_sessions_per_mesh_sender
max_tx_requests_per_session
nonce_creation_cooldown
max_payload_size
max_retries
```

---

## Dependency security

Soltastic uses JavaScript/TypeScript dependencies, Solana libraries, Meshtastic libraries, and Android dependencies.

Rules:

- pin dependency versions;
- review lockfile changes;
- do not run `npm audit fix --force` blindly;
- test after dependency upgrades;
- keep Android Gradle Plugin and SDK versions consistent;
- avoid adding unnecessary packages;
- review packages that touch crypto, BLE, signing, or serialization.

---

## Build and release security

### Web/server

Recommended:

- commit lockfiles;
- build from clean checkout;
- keep `.env` out of Git;
- keep server keypair out of Git;
- document exact Node.js version;
- avoid exposing gateway admin endpoints publicly;
- use HTTPS for remote web hosting;
- restrict CORS in production.

### Android

Recommended:

- sign release APKs;
- store signing keys securely;
- do not commit keystores;
- build from clean checkout;
- verify APK package name;
- distribute through trusted channel;
- document required permissions;
- minimize permissions;
- review native dependencies.

---

## Mainnet readiness checklist

### Protocol

- [ ] Binary payload protocol implemented.
- [ ] Protocol versioning added.
- [ ] Transaction IDs added.
- [ ] Session IDs added.
- [ ] Expiration fields added.
- [ ] Replay protection tested.
- [ ] Chunking rules defined if needed.
- [ ] Error codes finalized.

### Transaction safety

- [ ] Exact signed transaction verification audited.
- [ ] Receiver/amount/token preview verified.
- [ ] Gateway fee preview verified.
- [ ] Durable Nonce lifecycle audited.
- [ ] Nonce authority handling verified.
- [ ] Duplicate submission handling tested.
- [ ] Failed transaction handling tested.

### Gateway

- [ ] Rate limits implemented.
- [ ] Session expiration implemented.
- [ ] Idempotency implemented.
- [ ] Key management documented.
- [ ] Gateway balance monitoring added.
- [ ] RPC failover considered.
- [ ] Gateway logs sanitized.
- [ ] Gateway authentication roadmap defined.

### Client

- [ ] Clear transaction preview.
- [ ] Network indicator.
- [ ] Finality status model.
- [ ] Error UX.
- [ ] Wallet signing flow tested.
- [ ] Android BLE permissions tested.
- [ ] Browser BLE compatibility tested.
- [ ] No secrets in frontend/mobile code.

### Mesh

- [ ] Private channel recommendation documented.
- [ ] Published test PSK warning documented.
- [ ] Hop limit guidance documented.
- [ ] No background flooding.
- [ ] Payload size limits tested.
- [ ] Packet loss and retry behavior tested.

### Operations

- [ ] Monitoring.
- [ ] Alerting.
- [ ] Incident response.
- [ ] Key rotation plan.
- [ ] Backup and restore plan.
- [ ] Public risk disclaimer.
- [ ] Security contact.

---

## Incident response

### If a gateway key is exposed

1. Stop the gateway.
2. Move remaining funds to a new key.
3. Rotate the keypair.
4. Update `.env`.
5. Restart the gateway.
6. Review logs for suspicious transactions.
7. Publish notice if users may be affected.

### If a private Meshtastic channel key is exposed

1. Assume all channel members can read traffic.
2. Rotate the PSK for private deployments.
3. Update all devices.
4. Avoid sending sensitive data over the old channel.

### If a signing bug is discovered

1. Stop transaction relay.
2. Disable mainnet if enabled.
3. Reproduce on devnet.
4. Patch transaction construction.
5. Add regression tests.
6. Review all related flows.
7. Publish a security advisory if needed.


## Security disclaimer

Soltastic is an experimental devnet prototype.

It should not be used with real funds until the protocol, transaction construction, Durable Nonce lifecycle, gateway implementation, and client signing flow have been reviewed and tested for production use.

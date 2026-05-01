import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  NONCE_ACCOUNT_LENGTH,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const PORT = Number(process.env.PORT ?? 8787);
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SERVER_KEYPAIR = process.env.SERVER_KEYPAIR;

const MIN_SOL = Number(process.env.MIN_SOL ?? "0.002");

const SERVICE_FEE_LAMPORTS = BigInt(
  process.env.SERVICE_FEE_LAMPORTS ?? "2000000"
);

const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = BigInt(
  process.env.COMPUTE_UNIT_PRICE_MICRO_LAMPORTS ?? "100000"
);

const COMPUTE_UNIT_LIMIT = Number(process.env.COMPUTE_UNIT_LIMIT ?? "800000");

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

const NONCE_COOLDOWN_SECONDS = Number(
  process.env.NONCE_COOLDOWN_SECONDS ?? "3600"
);

const CONFIRM_TIMEOUT_MS = Number(process.env.CONFIRM_TIMEOUT_MS ?? "90000");
const CONFIRM_POLL_MS = Number(process.env.CONFIRM_POLL_MS ?? "1500");

if (!SERVER_KEYPAIR) {
  throw new Error("SERVER_KEYPAIR is required");
}

const keypairPath = path.isAbsolute(SERVER_KEYPAIR)
  ? SERVER_KEYPAIR
  : path.resolve(process.cwd(), SERVER_KEYPAIR);

const keypairRaw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));

const serverKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairRaw));
const serverFeePubkey = serverKeypair.publicKey;
const serverFeeAddress = serverFeePubkey.toBase58();

const connection = new Connection(RPC_URL, "confirmed");

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  "ComputeBudget111111111111111111111111111111"
);

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

type NonceRecord = {
  wallet: string;
  nonceAccount: string;
  nonceValue: string;
  txSig: string;
  createdAt: number;
  serverFeeAddress?: string;
  fromNode?: string;
};

type MeshWalletRecord = {
  wallet: string;
  updatedAt: number;
  lastInitPacketId?: string;
};

type InitBody = {
  wallet: string;
  fromNode?: number | string;
  packetId?: number | string;
};

type SubmitBody = {
  fromNode?: number | string;
  receiver: string;
  token: string;
  amount: string;
  signature: string;
};

class TxConfirmTimeoutError extends Error {}
class TxFailedOnChainError extends Error {}

const dataDir = path.resolve("data");
const nonceDbPath = path.join(dataDir, "nonce-store.json");
const meshWalletDbPath = path.join(dataDir, "mesh-wallet-store.json");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadJson<T>(filePath: string, fallback: T): T {
  ensureDataDir();

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function saveJson<T>(filePath: string, value: T) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadNonceDb(): Record<string, NonceRecord> {
  return loadJson<Record<string, NonceRecord>>(nonceDbPath, {});
}

function saveNonceDb(db: Record<string, NonceRecord>) {
  saveJson(nonceDbPath, db);
}

function deleteNonceRecord(
  db: Record<string, NonceRecord>,
  wallet: string,
  reason: string,
  meta: Record<string, unknown> = {}
) {
  const rec = db[wallet];

  if (!rec) {
    return;
  }

  delete db[wallet];
  saveNonceDb(db);

  app.log.warn(
    {
      wallet,
      reason,
      nonceAccount: rec.nonceAccount,
      nonceValue: rec.nonceValue,
      ...meta,
    },
    "nonce record deleted"
  );
}

function loadMeshWalletDb(): Record<string, MeshWalletRecord> {
  return loadJson<Record<string, MeshWalletRecord>>(meshWalletDbPath, {});
}

function saveMeshWalletDb(db: Record<string, MeshWalletRecord>) {
  saveJson(meshWalletDbPath, db);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function saveMeshWalletLink(
  fromNode: string,
  wallet: string,
  packetId?: string
) {
  const db = loadMeshWalletDb();

  db[fromNode] = {
    wallet,
    updatedAt: nowUnix(),
    ...(packetId ? { lastInitPacketId: packetId } : {}),
  };

  saveMeshWalletDb(db);
}

function getWalletByMeshNode(fromNode: string): string | null {
  const db = loadMeshWalletDb();
  return db[fromNode]?.wallet ?? null;
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "");
}

function formatTokenAmount(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "0";
}

function normalizeDecimalInput(value: string) {
  return String(value).trim().replace(",", ".");
}

function parseDecimalToUnits(value: string, decimals: number): bigint {
  const s = normalizeDecimalInput(value);

  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid amount format: ${value}`);
  }

  const [whole, fractionRaw = ""] = s.split(".");

  if (fractionRaw.length > decimals) {
    throw new Error(`Too many decimal places, max ${decimals}`);
  }

  const fraction = fractionRaw.padEnd(decimals, "0");

  const units =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");

  if (units <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  return units;
}

function bigintToSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is too large for safe JS number`);
  }

  return Number(value);
}

function base58Decode(value: string): Uint8Array {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let x = 0n;

  for (const ch of value) {
    const idx = alphabet.indexOf(ch);

    if (idx < 0) {
      throw new Error(`Invalid base58 character: ${ch}`);
    }

    x = x * 58n + BigInt(idx);
  }

  const bytes: number[] = [];

  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn));
    x >>= 8n;
  }

  for (const ch of value) {
    if (ch === "1") {
      bytes.unshift(0);
    } else {
      break;
    }
  }

  return Uint8Array.from(bytes);
}

function getAssociatedTokenAddressLocal(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return address;
}

function createTokenTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);

  data[0] = 3;
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function createComputeUnitPriceInstruction(
  microLamports: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);

  data[0] = 3;
  data.writeBigUInt64LE(microLamports, 1);

  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data,
  });
}

function createComputeUnitLimitInstruction(
  units: number
): TransactionInstruction {
  const data = Buffer.alloc(5);

  data[0] = 2;
  data.writeUInt32LE(units, 1);

  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data,
  });
}

async function getUsdcBalance(owner: PublicKey): Promise<string> {
  const ata = getAssociatedTokenAddressLocal(USDC_MINT, owner);

  try {
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    return formatTokenAmount(bal.value.uiAmountString);
  } catch {
    return "0";
  }
}

async function getBalances(wallet: PublicKey) {
  const lamports = await connection.getBalance(wallet, "confirmed");
  const sol = formatSol(lamports);
  const usdc = await getUsdcBalance(wallet);

  return {
    lamports,
    sol,
    usdc,
  };
}

async function readNonceInfo(nonceAccount: PublicKey): Promise<{
  nonceValue: string;
  authorizedPubkey: PublicKey;
} | null> {
  const nonce = await connection.getNonce(nonceAccount, "confirmed");

  if (!nonce) {
    return null;
  }

  return {
    nonceValue: nonce.nonce,
    authorizedPubkey: nonce.authorizedPubkey,
  };
}

async function readNonceValue(nonceAccount: PublicKey): Promise<string | null> {
  const info = await readNonceInfo(nonceAccount);
  return info?.nonceValue ?? null;
}

async function createDurableNonceForWallet(
  wallet: PublicKey
): Promise<NonceRecord> {
  const nonceKeypair = Keypair.generate();

  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH
  );

  const tx = SystemProgram.createNonceAccount({
    fromPubkey: serverKeypair.publicKey,
    noncePubkey: nonceKeypair.publicKey,
    authorizedPubkey: wallet,
    lamports: rentLamports,
  });

  const txSig = await sendAndConfirmTransaction(
    connection,
    tx,
    [serverKeypair, nonceKeypair],
    {
      commitment: "confirmed",
      skipPreflight: false,
    }
  );

  const nonceValue = await readNonceValue(nonceKeypair.publicKey);

  if (!nonceValue) {
    throw new Error("Nonce account created, but nonce value not readable");
  }

  return {
    wallet: wallet.toBase58(),
    nonceAccount: nonceKeypair.publicKey.toBase58(),
    nonceValue,
    txSig,
    serverFeeAddress,
    createdAt: nowUnix(),
  };
}

function buildRestoredTransaction(params: {
  senderPk: PublicKey;
  receiverPk: PublicKey;
  noncePk: PublicKey;
  nonceValue: string;
  serverFeePubkey: PublicKey;
  token: string;
  amountUnits: bigint;
}): Transaction {
  const {
    senderPk,
    receiverPk,
    noncePk,
    nonceValue,
    serverFeePubkey,
    token,
    amountUnits,
  } = params;

  const tx = new Transaction({
    feePayer: senderPk,
    recentBlockhash: nonceValue,
  });

  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
    })
  );

  tx.add(createComputeUnitPriceInstruction(COMPUTE_UNIT_PRICE_MICRO_LAMPORTS));
  tx.add(createComputeUnitLimitInstruction(COMPUTE_UNIT_LIMIT));

  if (token === "SOL") {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPk,
        toPubkey: receiverPk,
        lamports: bigintToSafeNumber(amountUnits, "amount lamports"),
      })
    );
  } else if (token === "USDC") {
    const senderAta = getAssociatedTokenAddressLocal(USDC_MINT, senderPk);
    const receiverAta = getAssociatedTokenAddressLocal(USDC_MINT, receiverPk);

    tx.add(
      createTokenTransferInstruction(
        senderAta,
        receiverAta,
        senderPk,
        amountUnits
      )
    );
  } else {
    throw new Error(`Unsupported token: ${token}`);
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: senderPk,
      toPubkey: serverFeePubkey,
      lamports: bigintToSafeNumber(
        SERVICE_FEE_LAMPORTS,
        "service fee lamports"
      ),
    })
  );

  tx.add(
    SystemProgram.nonceAuthorize({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
      newAuthorizedPubkey: serverFeePubkey,
    })
  );

  return tx;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExistingTxStatus(txSig: string) {
  const res = await connection.getSignatureStatuses([txSig], {
    searchTransactionHistory: true,
  });

  return res.value[0];
}

async function waitForExistingTxConfirmed(txSig: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getExistingTxStatus(txSig);

    app.log.info(
      {
        txSig,
        confirmationStatus: status?.confirmationStatus ?? null,
        err: status?.err ?? null,
      },
      "existing tx status poll"
    );

    if (status?.err) {
      return status;
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return status;
    }

    await sleep(1000);
  }

  return null;
}

async function waitForConfirmedTx(txSig: string) {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await connection.getSignatureStatuses([txSig], {
      searchTransactionHistory: true,
    });

    const status = res.value[0];

    app.log.info(
      {
        txSig,
        confirmationStatus: status?.confirmationStatus ?? null,
        err: status?.err ?? null,
      },
      "tx confirmation poll"
    );

    if (status?.err) {
      throw new TxFailedOnChainError(
        `Transaction failed: ${JSON.stringify(status.err)}`
      );
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return status;
    }

    await sleep(CONFIRM_POLL_MS);
  }

  throw new TxConfirmTimeoutError(`Transaction confirmation timeout: ${txSig}`);
}

async function withdrawNonceRemainder(params: {
  nonceAccount: PublicKey;
  reasonTxSig: string;
}) {
  const { nonceAccount, reasonTxSig } = params;

  const balance = await connection.getBalance(nonceAccount, "confirmed");

  app.log.info(
    {
      nonceAccount: nonceAccount.toBase58(),
      balance,
      reasonTxSig,
    },
    "nonce withdraw: balance checked"
  );

  if (balance <= 0) {
    app.log.info(
      {
        nonceAccount: nonceAccount.toBase58(),
      },
      "nonce withdraw: account already empty"
    );

    return null;
  }

  const nonceInfo = await readNonceInfo(nonceAccount);

  if (!nonceInfo) {
    app.log.info(
      {
        nonceAccount: nonceAccount.toBase58(),
      },
      "nonce withdraw: nonce account not readable, probably already closed"
    );

    return null;
  }

  if (!nonceInfo.authorizedPubkey.equals(serverFeePubkey)) {
    throw new Error(
      `Nonce authority mismatch before withdraw: expected ${serverFeeAddress}, got ${nonceInfo.authorizedPubkey.toBase58()}`
    );
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const withdrawTx = new Transaction({
    feePayer: serverFeePubkey,
    recentBlockhash: blockhash,
  });

  withdrawTx.add(
    SystemProgram.nonceWithdraw({
      noncePubkey: nonceAccount,
      authorizedPubkey: serverFeePubkey,
      toPubkey: serverFeePubkey,
      lamports: balance,
    })
  );

  withdrawTx.sign(serverKeypair);

  const rawWithdrawTx = withdrawTx.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });

  app.log.info(
    {
      nonceAccount: nonceAccount.toBase58(),
      lamports: balance,
      rawTxBytes: rawWithdrawTx.length,
    },
    "nonce withdraw: sending to rpc"
  );

  const withdrawSig = await connection.sendRawTransaction(rawWithdrawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  app.log.info(
    {
      nonceAccount: nonceAccount.toBase58(),
      withdrawSig,
    },
    "nonce withdraw: rpc accepted"
  );

  const confirmResult = await connection.confirmTransaction(
    {
      signature: withdrawSig,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmResult.value.err) {
    throw new Error(
      `Nonce withdraw failed: ${JSON.stringify(confirmResult.value.err)}`
    );
  }

  app.log.info(
    {
      nonceAccount: nonceAccount.toBase58(),
      withdrawSig,
      lamports: balance,
    },
    "nonce withdraw: confirmed"
  );

  return {
    withdrawSig,
    lamports: balance,
  };
}

async function cleanupNonceIfServerAuthority(params: {
  nonceDb: Record<string, NonceRecord>;
  wallet: string;
  nonceAccount: PublicKey;
  reason: string;
  fromNode?: string | null;
}) {
  const { nonceDb, wallet, nonceAccount, reason, fromNode } = params;

  const nonceInfo = await readNonceInfo(nonceAccount);

  if (nonceInfo?.authorizedPubkey.equals(serverFeePubkey)) {
    try {
      await withdrawNonceRemainder({
        nonceAccount,
        reasonTxSig: reason,
      });
    } catch (withdrawErr: any) {
      app.log.error(
        {
          err: withdrawErr?.message ?? String(withdrawErr),
          nonceAccount: nonceAccount.toBase58(),
          wallet,
          reason,
        },
        "nonce cleanup withdraw failed"
      );
    }
  }

  deleteNonceRecord(nonceDb, wallet, reason, {
    fromNode,
    nonceAccount: nonceAccount.toBase58(),
    nonceAuthority: nonceInfo?.authorizedPubkey.toBase58() ?? null,
  });
}

app.get("/api/status", async () => {
  const serverLamports = await connection.getBalance(
    serverFeePubkey,
    "confirmed"
  );

  return {
    ok: true,
    rpc: RPC_URL,
    serverFeeAddress,
    serverSol: formatSol(serverLamports),
    usdcMint: USDC_MINT.toBase58(),
    minSol: MIN_SOL,
    serviceFeeLamports: SERVICE_FEE_LAMPORTS.toString(),
    computeUnitPriceMicroLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS.toString(),
    computeUnitLimit: COMPUTE_UNIT_LIMIT,
  };
});

app.post<{
  Body: InitBody;
}>("/api/init", async (req, reply) => {
  let wallet: PublicKey;

  try {
    wallet = new PublicKey(req.body.wallet);
  } catch {
    return reply.code(400).send({
      ok: false,
      response: "ST,S=0,C=0,e=2",
      error: "Invalid wallet address",
    });
  }

  const walletBase58 = wallet.toBase58();

  const fromNode =
    req.body.fromNode !== undefined && req.body.fromNode !== null
      ? String(req.body.fromNode)
      : null;

  const packetId =
    req.body.packetId !== undefined && req.body.packetId !== null
      ? String(req.body.packetId)
      : undefined;

  if (fromNode) {
    saveMeshWalletLink(fromNode, walletBase58, packetId);
  }

  req.log.info(
    {
      wallet: walletBase58,
      fromNode,
      packetId,
    },
    "init request"
  );

  try {
    const balances = await getBalances(wallet);

    if (balances.lamports < MIN_SOL * LAMPORTS_PER_SOL) {
      return {
        ok: true,
        response: `ST,S=${balances.sol},C=${balances.usdc},e=1`,
        sol: balances.sol,
        usdc: balances.usdc,
      };
    }

    const db = loadNonceDb();
    const existing = db[walletBase58];
    const now = nowUnix();

    if (existing && now - existing.createdAt < NONCE_COOLDOWN_SECONDS) {
      const existingNoncePk = new PublicKey(existing.nonceAccount);
      const nonceInfo = await readNonceInfo(existingNoncePk);

      if (nonceInfo && nonceInfo.authorizedPubkey.equals(wallet)) {
        existing.nonceValue = nonceInfo.nonceValue;
        existing.serverFeeAddress = existing.serverFeeAddress ?? serverFeeAddress;

        if (fromNode) {
          existing.fromNode = fromNode;
        }

        db[walletBase58] = existing;
        saveNonceDb(db);

        const response = `ST,S=${balances.sol},C=${balances.usdc},a=${existing.nonceAccount},v=${existing.nonceValue},p=${existing.serverFeeAddress}`;

        req.log.info(
          {
            wallet: walletBase58,
            reused: true,
            nonceAccount: existing.nonceAccount,
            nonceValue: existing.nonceValue,
            serverFeeAddress: existing.serverFeeAddress,
            response,
          },
          "init response"
        );

        return {
          ok: true,
          reused: true,
          response,
          sol: balances.sol,
          usdc: balances.usdc,
          nonceAccount: existing.nonceAccount,
          nonceValue: existing.nonceValue,
          serverFeeAddress: existing.serverFeeAddress,
        };
      }

      req.log.warn(
        {
          wallet: walletBase58,
          oldNonceAccount: existing.nonceAccount,
          oldAuthority: nonceInfo?.authorizedPubkey.toBase58() ?? null,
        },
        "existing nonce cannot be reused; cleanup and create new nonce"
      );

      await cleanupNonceIfServerAuthority({
        nonceDb: db,
        wallet: walletBase58,
        nonceAccount: existingNoncePk,
        reason: "init found non-reusable nonce",
        fromNode,
      });
    }

    const rec = await createDurableNonceForWallet(wallet);

    if (fromNode) {
      rec.fromNode = fromNode;
    }

    db[walletBase58] = rec;
    saveNonceDb(db);

    const response = `ST,S=${balances.sol},C=${balances.usdc},a=${rec.nonceAccount},v=${rec.nonceValue},p=${rec.serverFeeAddress ?? serverFeeAddress}`;

    req.log.info(
      {
        wallet: walletBase58,
        reused: false,
        nonceAccount: rec.nonceAccount,
        nonceValue: rec.nonceValue,
        serverFeeAddress: rec.serverFeeAddress ?? serverFeeAddress,
        txSig: rec.txSig,
        response,
      },
      "init response"
    );

    return {
      ok: true,
      reused: false,
      response,
      sol: balances.sol,
      usdc: balances.usdc,
      nonceAccount: rec.nonceAccount,
      nonceValue: rec.nonceValue,
      serverFeeAddress: rec.serverFeeAddress ?? serverFeeAddress,
      txSig: rec.txSig,
    };
  } catch (err: any) {
    req.log.error(err);

    return reply.code(500).send({
      ok: false,
      response: "ST,S=0,C=0,e=2",
      error: err?.message ?? String(err),
    });
  }
});

app.post<{
  Body: SubmitBody;
}>("/api/submit", async (req, reply) => {
  const fromNode =
    req.body.fromNode !== undefined && req.body.fromNode !== null
      ? String(req.body.fromNode)
      : null;

  req.log.info(
    {
      fromNode,
      receiver: req.body.receiver,
      token: req.body.token,
      amount: req.body.amount,
      signature: req.body.signature,
    },
    "submit request"
  );

  try {
    if (!fromNode) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=4",
        error: "fromNode is required",
      });
    }

    const senderWallet = getWalletByMeshNode(fromNode);

    if (!senderWallet) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=4",
        error: "Unknown mesh sender, init required",
      });
    }

    const nonceDb = loadNonceDb();
    const rec = nonceDb[senderWallet];

    if (!rec) {
      const status = await getExistingTxStatus(req.body.signature);

      if (
        status &&
        !status.err &&
        (status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized")
      ) {
        const response = `ST,${req.body.signature}`;

        req.log.info(
          {
            txSig: req.body.signature,
            response,
            alreadyConfirmed: true,
          },
          "submit without nonce record but tx already confirmed"
        );

        return {
          ok: true,
          confirmed: true,
          alreadyConfirmed: true,
          txSig: req.body.signature,
          response,
        };
      }

      return reply.code(400).send({
        ok: false,
        response: "ST,e=5",
        error: "Nonce record not found for wallet",
      });
    }

    const senderPk = new PublicKey(senderWallet);
    const receiverPk = new PublicKey(req.body.receiver);
    const noncePk = new PublicKey(rec.nonceAccount);

    const token = String(req.body.token).trim().toUpperCase();
    const decimals = token === "SOL" ? 9 : token === "USDC" ? 6 : null;

    if (decimals === null) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=3",
        error: `Unsupported token: ${req.body.token}`,
      });
    }

    const amountUnits = parseDecimalToUnits(req.body.amount, decimals);
    const nonceInfo = await readNonceInfo(noncePk);
    const currentNonce = nonceInfo?.nonceValue ?? null;

    req.log.info(
      {
        step: "1/3 recreate transaction",
        fromNode,
        senderWallet,
        receiver: receiverPk.toBase58(),
        token,
        amount: req.body.amount,
        amountUnits: amountUnits.toString(),
        nonceAccount: rec.nonceAccount,
        storedNonceValue: rec.nonceValue,
        currentNonce,
        nonceAuthority: nonceInfo?.authorizedPubkey.toBase58() ?? null,
        serverFeeAddress: rec.serverFeeAddress ?? serverFeeAddress,
      },
      "1/3 recreate transaction"
    );

    if (!nonceInfo) {
      deleteNonceRecord(nonceDb, senderWallet, "nonce account not found", {
        fromNode,
        nonceAccount: noncePk.toBase58(),
      });

      return reply.code(400).send({
        ok: false,
        response: "ST,e=5",
        error: "Nonce account not found",
      });
    }

    if (!nonceInfo.authorizedPubkey.equals(senderPk)) {
      const actualAuthority = nonceInfo.authorizedPubkey.toBase58();
      const clientTxSig = req.body.signature;

      req.log.warn(
        {
          fromNode,
          senderWallet,
          nonceAccount: noncePk.toBase58(),
          expectedAuthority: senderPk.toBase58(),
          actualAuthority,
          clientTxSig,
        },
        "nonce authority mismatch; checking if client tx already confirmed"
      );

      const existingStatus = await waitForExistingTxConfirmed(clientTxSig);

      if (
        existingStatus &&
        !existingStatus.err &&
        (existingStatus.confirmationStatus === "confirmed" ||
          existingStatus.confirmationStatus === "finalized")
      ) {
        let nonceWithdrawResult: Awaited<
          ReturnType<typeof withdrawNonceRemainder>
        > | null = null;

        if (nonceInfo.authorizedPubkey.equals(serverFeePubkey)) {
          try {
            nonceWithdrawResult = await withdrawNonceRemainder({
              nonceAccount: noncePk,
              reasonTxSig: clientTxSig,
            });
          } catch (withdrawErr: any) {
            req.log.error(
              {
                err: withdrawErr?.message ?? String(withdrawErr),
                nonceAccount: noncePk.toBase58(),
                clientTxSig,
              },
              "nonce withdraw failed after already confirmed tx"
            );
          }
        }

        deleteNonceRecord(nonceDb, senderWallet, "already confirmed transaction", {
          fromNode,
          txSig: clientTxSig,
          actualAuthority,
          nonceWithdraw: nonceWithdrawResult,
        });

        const response = `ST,${clientTxSig}`;

        req.log.info(
          {
            txSig: clientTxSig,
            response,
            nonceWithdraw: nonceWithdrawResult,
          },
          "already confirmed transaction handled idempotently"
        );

        return {
          ok: true,
          confirmed: true,
          alreadyConfirmed: true,
          txSig: clientTxSig,
          response,
          nonceWithdraw: nonceWithdrawResult,
        };
      }

      if (nonceInfo.authorizedPubkey.equals(serverFeePubkey)) {
        try {
          await withdrawNonceRemainder({
            nonceAccount: noncePk,
            reasonTxSig: "authority-mismatch-cleanup",
          });
        } catch (withdrawErr: any) {
          req.log.error(
            {
              err: withdrawErr?.message ?? String(withdrawErr),
              nonceAccount: noncePk.toBase58(),
              senderWallet,
            },
            "nonce cleanup withdraw failed"
          );
        }
      }

      deleteNonceRecord(nonceDb, senderWallet, "nonce authority mismatch", {
        fromNode,
        expectedAuthority: senderPk.toBase58(),
        actualAuthority,
        existingConfirmationStatus: existingStatus?.confirmationStatus ?? null,
        existingErr: existingStatus?.err ?? null,
      });

      return reply.code(400).send({
        ok: false,
        response: "ST,e=5",
        error: `Nonce authority mismatch: expected ${senderPk.toBase58()}, got ${actualAuthority}`,
      });
    }

    if (!currentNonce || currentNonce !== rec.nonceValue) {
      deleteNonceRecord(nonceDb, senderWallet, "nonce value mismatch", {
        fromNode,
        storedNonceValue: rec.nonceValue,
        currentNonce,
      });

      return reply.code(400).send({
        ok: false,
        response: "ST,e=5",
        error: "Nonce is no longer valid or already used",
      });
    }

    const tx = buildRestoredTransaction({
      senderPk,
      receiverPk,
      noncePk,
      nonceValue: rec.nonceValue,
      serverFeePubkey: new PublicKey(rec.serverFeeAddress ?? serverFeeAddress),
      token,
      amountUnits,
    });

    req.log.info(
      {
        feePayer: tx.feePayer?.toBase58(),
        recentBlockhash: tx.recentBlockhash,
        instructionCount: tx.instructions.length,
        programIds: tx.instructions.map((ix) => ix.programId.toBase58()),
      },
      "transaction recreated"
    );

    let sigBytes: Uint8Array;

    try {
      sigBytes = base58Decode(req.body.signature);
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=6",
        error: err?.message ?? String(err),
      });
    }

    if (sigBytes.length !== 64) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=6",
        error: `Invalid signature length: ${sigBytes.length}`,
      });
    }

    tx.addSignature(senderPk, Buffer.from(sigBytes));

    const verifyOk = tx.verifySignatures(true);

    req.log.info(
      {
        step: "2/3 check signature",
        verifyOk,
        signatureBytes: sigBytes.length,
      },
      "2/3 check signature"
    );

    if (!verifyOk) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=6",
        error: "Client signature verification failed",
      });
    }

    let rawTx: Buffer;

    try {
      rawTx = tx.serialize({
        requireAllSignatures: true,
        verifySignatures: true,
      });
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        response: "ST,e=6",
        error: err?.message ?? String(err),
      });
    }

    req.log.info(
      {
        step: "3/3 send to RPC node",
        rawTxBytes: rawTx.length,
      },
      "3/3 send to RPC node"
    );

    const txSig = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    req.log.info(
      {
        txSig,
      },
      "RPC accepted transaction"
    );

    req.log.info(
      {
        txSig,
        confirmTimeoutMs: CONFIRM_TIMEOUT_MS,
        confirmPollMs: CONFIRM_POLL_MS,
      },
      "waiting for confirmed transaction"
    );

    await waitForConfirmedTx(txSig);

    let nonceWithdrawResult: Awaited<
      ReturnType<typeof withdrawNonceRemainder>
    > | null = null;

    try {
      nonceWithdrawResult = await withdrawNonceRemainder({
        nonceAccount: noncePk,
        reasonTxSig: txSig,
      });
    } catch (withdrawErr: any) {
      req.log.error(
        {
          err: withdrawErr?.message ?? String(withdrawErr),
          nonceAccount: noncePk.toBase58(),
          txSig,
        },
        "nonce withdraw failed after confirmed user transaction"
      );
    }

    deleteNonceRecord(nonceDb, senderWallet, "confirmed user transaction", {
      fromNode,
      txSig,
      nonceWithdraw: nonceWithdrawResult,
    });

    const response = `ST,${txSig}`;

    req.log.info(
      {
        txSig,
        response,
        nonceWithdraw: nonceWithdrawResult,
      },
      "transaction confirmed and nonce cleanup attempted"
    );

    return {
      ok: true,
      confirmed: true,
      txSig,
      response,
      nonceWithdraw: nonceWithdrawResult,
    };
  } catch (err: any) {
    req.log.error(err);

    if (err instanceof TxConfirmTimeoutError) {
      return reply.code(504).send({
        ok: false,
        response: "ST,e=7",
        error: err.message,
      });
    }

    if (err instanceof TxFailedOnChainError) {
      return reply.code(500).send({
        ok: false,
        response: "ST,e=8",
        error: err.message,
      });
    }

    return reply.code(500).send({
      ok: false,
      response: "ST,e=3",
      error: err?.message ?? String(err),
    });
  }
});

app.listen({
  port: PORT,
  host: "0.0.0.0",
});
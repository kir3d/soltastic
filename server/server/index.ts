import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  NONCE_ACCOUNT_LENGTH,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PORT = Number(process.env.PORT ?? 8787);
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SERVER_KEYPAIR = process.env.SERVER_KEYPAIR;
const MIN_SOL = Number(process.env.MIN_SOL ?? "0.002");

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

const NONCE_COOLDOWN_SECONDS = Number(
  process.env.NONCE_COOLDOWN_SECONDS ?? "3600"
);

if (!SERVER_KEYPAIR) {
  throw new Error("SERVER_KEYPAIR is required");
}

const keypairPath = path.isAbsolute(SERVER_KEYPAIR)
  ? SERVER_KEYPAIR
  : path.resolve(process.cwd(), SERVER_KEYPAIR);

const keypairRaw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(keypairRaw));

const connection = new Connection(RPC_URL, "confirmed");

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

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
};

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "nonce-store.json");

function loadDb(): Record<string, NonceRecord> {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function saveDb(db: Record<string, NonceRecord>) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL)
    .toFixed(9)
    .replace(/\.?0+$/, "");
}

function formatTokenAmount(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "0";
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

async function readNonceValue(nonceAccount: PublicKey): Promise<string | null> {
  const nonce = await connection.getNonce(nonceAccount, "confirmed");
  return nonce?.nonce ?? null;
}

async function createDurableNonceForWallet(
  wallet: PublicKey
): Promise<NonceRecord> {
  const nonceKeypair = Keypair.generate();

  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH
  );

  const tx = SystemProgram.createNonceAccount({
    fromPubkey: payer.publicKey,
    noncePubkey: nonceKeypair.publicKey,
    authorizedPubkey: wallet,
    lamports: rentLamports,
  });

  const txSig = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, nonceKeypair],
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
    createdAt: Math.floor(Date.now() / 1000),
  };
}

app.get("/api/status", async () => {
  const payerLamports = await connection.getBalance(
    payer.publicKey,
    "confirmed"
  );

  return {
    ok: true,
    rpc: RPC_URL,
    payer: payer.publicKey.toBase58(),
    payerSol: formatSol(payerLamports),
    usdcMint: USDC_MINT.toBase58(),
    minSol: MIN_SOL,
  };
});

app.post<{
  Body: {
    wallet: string;
    fromNode?: number | string;
  };
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

    const db = loadDb();
    const walletBase58 = wallet.toBase58();
    const existing = db[walletBase58];
    const now = Math.floor(Date.now() / 1000);

    if (existing && now - existing.createdAt < NONCE_COOLDOWN_SECONDS) {
      const currentNonce = await readNonceValue(
        new PublicKey(existing.nonceAccount)
      );

      if (currentNonce) {
        existing.nonceValue = currentNonce;
        db[walletBase58] = existing;
        saveDb(db);

        return {
          ok: true,
          reused: true,
          response: `ST,S=${balances.sol},C=${balances.usdc},a=${existing.nonceAccount},v=${existing.nonceValue}`,
          sol: balances.sol,
          usdc: balances.usdc,
          nonceAccount: existing.nonceAccount,
          nonceValue: existing.nonceValue,
        };
      }
    }

    const rec = await createDurableNonceForWallet(wallet);

    db[walletBase58] = rec;
    saveDb(db);

    return {
      ok: true,
      reused: false,
      response: `ST,S=${balances.sol},C=${balances.usdc},a=${rec.nonceAccount},v=${rec.nonceValue}`,
      sol: balances.sol,
      usdc: balances.usdc,
      nonceAccount: rec.nonceAccount,
      nonceValue: rec.nonceValue,
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

app.listen({
  port: PORT,
  host: "0.0.0.0",
});

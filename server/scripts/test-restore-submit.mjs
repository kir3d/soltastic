import "dotenv/config";

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const SERVICE_FEE_LAMPORTS = BigInt(
  process.env.SERVICE_FEE_LAMPORTS ?? "2000000"
);

const CONFIRM_TIMEOUT_MS = Number(process.env.CONFIRM_TIMEOUT_MS ?? "90000");
const CONFIRM_POLL_MS = Number(process.env.CONFIRM_POLL_MS ?? "1500");

// Реальная отправка только если SEND_TX=1
const SEND_TX = process.env.SEND_TX === "1";

// Данные из твоего теста
const INIT_MESSAGE =
  "ST,init,EKmrC9b1PrSZoN1VoNorThLx9yWANKrNoTaqWxboodpA";

const INIT_RESPONSE =
  "ST,S=0.4,C=0,a=DGwcFGNWE3ZcaFTNmKsW78FqFppgVMtXuvGuBRdnEr9o,v=2LZxnTxPEB3XEMssZ84nsabovNTg54TmxSLRjX5hqZnE,p=64bWK9ejiC9Kxk6jNfTDaaMemXX8Fp5zxuWMeZoyHevm";

const TX_MESSAGE =
  "ST,GEhXXp1VaZSaz2pWz2hZPSDZKPvY4rm9funo1mcEHRue,SOL,0.001,zFPEyecacN7ak29teQ7nH2YaNeTjhdCb8jLC1PoX8VUJSiEcomqXa9RxRvw7Wa92B1ZVas8tgwA1QQiJAy1SLD1";

const connection = new Connection(RPC_URL, "confirmed");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base58Decode(value) {
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

  const bytes = [];

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

function normalizeDecimalInput(value) {
  return String(value).trim().replace(",", ".");
}

function parseDecimalToUnits(value, decimals) {
  const s = normalizeDecimalInput(value);

  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid amount format: ${value}`);
  }

  const [whole, fractionRaw = ""] = s.split(".");

  if (fractionRaw.length > decimals) {
    throw new Error(`Too many decimals, max ${decimals}`);
  }

  const fraction = fractionRaw.padEnd(decimals, "0");

  const units =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");

  if (units <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  return units;
}

function bigintToSafeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is too large for safe JS number`);
  }

  return Number(value);
}

function parseInitMessage(text) {
  const parts = text.split(",");

  if (parts.length !== 3 || parts[0] !== "ST" || parts[1] !== "init") {
    throw new Error(`Invalid init message: ${text}`);
  }

  return {
    wallet: parts[2],
  };
}

function parseInitResponse(text) {
  if (!text.startsWith("ST,")) {
    throw new Error(`Invalid init response: ${text}`);
  }

  const fields = {};

  for (const part of text.split(",").slice(1)) {
    const idx = part.indexOf("=");

    if (idx <= 0) {
      continue;
    }

    fields[part.slice(0, idx)] = part.slice(idx + 1);
  }

  if (!fields.a || !fields.v || !fields.p) {
    throw new Error(`Init response does not contain a/v/p: ${text}`);
  }

  return {
    nonceAccount: fields.a,
    nonceValue: fields.v,
    serverFeeAddress: fields.p,
    sol: fields.S ?? "0",
    usdc: fields.C ?? "0",
  };
}

function parseTxMessage(text) {
  const parts = text.split(",");

  if (parts.length !== 5 || parts[0] !== "ST") {
    throw new Error(`Invalid tx message: ${text}`);
  }

  return {
    receiver: parts[1],
    token: parts[2].toUpperCase(),
    amount: parts[3],
    signature: parts[4],
  };
}

async function readNonceValue(nonceAccount) {
  const nonce = await connection.getNonce(nonceAccount, "confirmed");
  return nonce?.nonce ?? null;
}

function buildRestoredTransaction({
  senderPk,
  receiverPk,
  noncePk,
  nonceValue,
  serverFeePubkey,
  token,
  amountUnits,
}) {
  const tx = new Transaction({
    feePayer: senderPk,
    recentBlockhash: nonceValue,
  });

  console.log("1. add nonceAdvance");
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
    })
  );

  if (token === "SOL") {
    console.log("2. add SOL transfer sender -> receiver");
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPk,
        toPubkey: receiverPk,
        lamports: bigintToSafeNumber(amountUnits, "amount lamports"),
      })
    );
  } else {
    throw new Error(`This test script currently supports only SOL, got ${token}`);
  }

  console.log("3. add service fee sender -> serverFeePubkey");
  tx.add(
    SystemProgram.transfer({
      fromPubkey: senderPk,
      toPubkey: serverFeePubkey,
      lamports: bigintToSafeNumber(SERVICE_FEE_LAMPORTS, "service fee lamports"),
    })
  );

  console.log("4. add nonceAuthorize sender -> serverFeePubkey");
  tx.add(
    SystemProgram.nonceAuthorize({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
      newAuthorizedPubkey: serverFeePubkey,
    })
  );

  return tx;
}

async function waitForConfirmedTx(txSig) {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await connection.getSignatureStatuses([txSig], {
      searchTransactionHistory: true,
    });

    const status = res.value[0];

    console.log("confirmation status:", status?.confirmationStatus ?? "null");

    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return status;
    }

    await sleep(CONFIRM_POLL_MS);
  }

  throw new Error(`Confirmation timeout: ${txSig}`);
}

async function main() {
  console.log("RPC:", RPC_URL);
  console.log("SEND_TX:", SEND_TX ? "YES" : "NO, dry-run only");
  console.log("");

  const init = parseInitMessage(INIT_MESSAGE);
  const initResponse = parseInitResponse(INIT_RESPONSE);
  const txMessage = parseTxMessage(TX_MESSAGE);

  console.log("INIT wallet:", init.wallet);
  console.log("nonceAccount:", initResponse.nonceAccount);
  console.log("nonceValue:", initResponse.nonceValue);
  console.log("serverFeeAddress:", initResponse.serverFeeAddress);
  console.log("");

  console.log("TX receiver:", txMessage.receiver);
  console.log("TX token:", txMessage.token);
  console.log("TX amount:", txMessage.amount);
  console.log("TX signature:", txMessage.signature);
  console.log("");

  const senderPk = new PublicKey(init.wallet);
  const receiverPk = new PublicKey(txMessage.receiver);
  const noncePk = new PublicKey(initResponse.nonceAccount);
  const serverFeePubkey = new PublicKey(initResponse.serverFeeAddress);

  const decimals = txMessage.token === "SOL" ? 9 : 6;
  const amountUnits = parseDecimalToUnits(txMessage.amount, decimals);

  console.log("sender:", senderPk.toBase58());
  console.log("receiver:", receiverPk.toBase58());
  console.log("amount units:", amountUnits.toString());
  console.log("service fee lamports:", SERVICE_FEE_LAMPORTS.toString());
  console.log("");

  console.log("Checking current nonce on-chain...");
  const currentNonce = await readNonceValue(noncePk);

  console.log("current nonce:", currentNonce);
  console.log("expected nonce:", initResponse.nonceValue);

  if (!currentNonce) {
    throw new Error("Nonce account not found or not readable");
  }

  if (currentNonce !== initResponse.nonceValue) {
    throw new Error(
      "Nonce mismatch. This signature was made for another nonce value, " +
        "or this nonce was already used/advanced."
    );
  }

  console.log("Nonce OK");
  console.log("");

  console.log("Restoring transaction...");
  const tx = buildRestoredTransaction({
    senderPk,
    receiverPk,
    noncePk,
    nonceValue: initResponse.nonceValue,
    serverFeePubkey,
    token: txMessage.token,
    amountUnits,
  });

  console.log("");
  console.log("feePayer:", tx.feePayer?.toBase58());
  console.log("recentBlockhash:", tx.recentBlockhash);
  console.log("instructions:", tx.instructions.length);
  console.log("");

  console.log("Adding client signature...");
  const sigBytes = base58Decode(txMessage.signature);

  console.log("signature bytes:", sigBytes.length);

  if (sigBytes.length !== 64) {
    throw new Error(`Invalid signature length: ${sigBytes.length}`);
  }

  tx.addSignature(senderPk, Buffer.from(sigBytes));

  console.log("Verifying signature locally...");

  const verifyOk = tx.verifySignatures(true);

  console.log("verifySignatures:", verifyOk);

  if (!verifyOk) {
    throw new Error(
      "Signature verification failed. " +
        "Server-restored transaction is not byte-identical to client transaction."
    );
  }

  const rawTx = tx.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });

  console.log("serialize OK");
  console.log("raw tx bytes:", rawTx.length);
  console.log("");

  try {
    console.log("Simulating transaction...");
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    });

    console.log("simulation err:", JSON.stringify(sim.value.err));
    console.log("simulation logs:");
    for (const line of sim.value.logs ?? []) {
      console.log("  ", line);
    }

    if (sim.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
    }

    console.log("Simulation OK");
  } catch (err) {
    console.log("Simulation error/warning:", err?.message ?? String(err));
    throw err;
  }

  console.log("");

  if (!SEND_TX) {
    console.log("DRY RUN завершён.");
    console.log("Чтобы реально отправить в RPC:");
    console.log("SEND_TX=1 node scripts/test-restore-submit.mjs");
    return;
  }

  console.log("Sending raw transaction to RPC...");
  const txSig = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  console.log("RPC accepted txSig:", txSig);
  console.log("Waiting for confirmed/finalized...");

  await waitForConfirmedTx(txSig);

  console.log("");
  console.log("CONFIRMED");
  console.log(`Client response should be: ST,${txSig}`);
}

main().catch((err) => {
  console.error("");
  console.error("FAILED:");
  console.error(err?.stack ?? err?.message ?? String(err));
  process.exit(1);
});

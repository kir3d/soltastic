import "dotenv/config";

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// Реальная отправка только если SEND_TX=1
const SEND_TX = process.env.SEND_TX === "1";

const SERVICE_FEE_LAMPORTS = BigInt(
  process.env.SERVICE_FEE_LAMPORTS ?? "2000000"
);

const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = BigInt(
  process.env.COMPUTE_UNIT_PRICE_MICRO_LAMPORTS ?? "100000"
);

const COMPUTE_UNIT_LIMIT = Number(process.env.COMPUTE_UNIT_LIMIT ?? "800000");

const CONFIRM_TIMEOUT_MS = Number(process.env.CONFIRM_TIMEOUT_MS ?? "90000");
const CONFIRM_POLL_MS = Number(process.env.CONFIRM_POLL_MS ?? "1500");

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  "ComputeBudget111111111111111111111111111111"
);

// Init от клиента
const INIT_MESSAGE =
  "ST,init,EKmrC9b1PrSZoN1VoNorThLx9yWANKrNoTaqWxboodpA";

// Ответ сервера клиенту
const INIT_RESPONSE =
  "ST,S=0.4,C=0,a=EYwmeuYyogd9hWDGpwFws7WuErAhmPqCizsdB7wG6gYJ,v=2rSTDMpEmZYYKtj3ewBxXAsigF7AkN2cdNUrcwSumjNe,p=64bWK9ejiC9Kxk6jNfTDaaMemXX8Fp5zxuWMeZoyHevm";

// Новое сообщение клиента после подписи
const TX_MESSAGE =
  "ST,GEhXXp1VaZSaz2pWz2hZPSDZKPvY4rm9funo1mcEHRue,SOL,0.0001,pyCqzsqT7DbnQtHiMXnEoK6XtYC49kPSoVmJcxkaR1Kvpep66iZ7qxUi7CTmike5Mi4nt6jxwimWz14W8XWEg8U";

// signed message base64 из браузера после Phantom signTransaction()
const EXPECTED_SIGNED_MESSAGE_BASE64 =
  "AQADB8X3GDUputLVS7vrzTBNQ5Xi4cC8KruGhGJYZkHZXklPSzYxQ1RqrPbx8AgpcZ4tYAoOkvIaLjzp6F8hYSfenaLJVt0XKRFYSWx0NzPtD69zsmE8zVew7lXMXN3WZJCAi+JhrYGwEC5tvXcKdF8RX4AjL14Ow3w17DNbqBi2Rvt9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAan1RcZLFaO4IqEX3PSl4jPA1wxRbIas0TYBi6pQAAAG4Xs2L/HhKXPk7uTHFQzySFegVvG9eM1f9lSZiYYQ48GBAMCBgAEBAAAAAUACQOghgEAAAAAAAUABQIANQwABAIAAwwCAAAAoIYBAAAAAAAEAgABDAIAAACAhB4AAAAAAAQCAgAkBwAAAEs2MUNUaqz28fAIKXGeLWAKDpLyGi486ehfIWEn3p2i";

const connection = new Connection(RPC_URL, "confirmed");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
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

function createComputeUnitPriceInstruction(microLamports) {
  const data = Buffer.alloc(9);

  // ComputeBudgetInstruction::SetComputeUnitPrice
  // tag = 3, u64 little-endian
  data[0] = 3;
  data.writeBigUInt64LE(BigInt(microLamports), 1);

  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data,
  });
}

function createComputeUnitLimitInstruction(units) {
  const data = Buffer.alloc(5);

  // ComputeBudgetInstruction::SetComputeUnitLimit
  // tag = 2, u32 little-endian
  data[0] = 2;
  data.writeUInt32LE(Number(units), 1);

  return new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data,
  });
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

  // Durable nonce transaction MUST start with nonceAdvance.
  console.log("1. add nonceAdvance");
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
    })
  );

  console.log("2. add ComputeBudget setComputeUnitPrice");
  tx.add(createComputeUnitPriceInstruction(COMPUTE_UNIT_PRICE_MICRO_LAMPORTS));

  console.log("3. add ComputeBudget setComputeUnitLimit");
  tx.add(createComputeUnitLimitInstruction(COMPUTE_UNIT_LIMIT));

  if (token === "SOL") {
    console.log("4. add SOL transfer sender -> receiver");
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

  console.log("5. add service fee sender -> serverFeePubkey");
  tx.add(
    SystemProgram.transfer({
      fromPubkey: senderPk,
      toPubkey: serverFeePubkey,
      lamports: bigintToSafeNumber(SERVICE_FEE_LAMPORTS, "service fee lamports"),
    })
  );

  console.log("6. add nonceAuthorize sender -> serverFeePubkey");
  tx.add(
    SystemProgram.nonceAuthorize({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
      newAuthorizedPubkey: serverFeePubkey,
    })
  );

  return tx;
}

function dumpTransaction(label, tx) {
  const messageBytes = tx.serializeMessage();
  const messageBase64 = bytesToBase64(messageBytes);

  console.log("");
  console.log(`${label} message base64:`);
  console.log(messageBase64);

  console.log("");
  console.log(`${label} message bytes length:`, messageBytes.length);
  console.log(`${label} feePayer:`, tx.feePayer?.toBase58());
  console.log(`${label} recentBlockhash:`, tx.recentBlockhash);
  console.log(`${label} instructions:`, tx.instructions.length);

  console.log("");
  console.log(`${label} program ids:`);
  tx.instructions.forEach((ix, i) => {
    console.log(`${i + 1}. ${ix.programId.toBase58()}`);
  });

  console.log("");
  console.log(`${label} instruction data hex:`);
  tx.instructions.forEach((ix, i) => {
    console.log(`${i + 1}. ${bytesToHex(ix.data)}`);
  });

  console.log("");
  console.log(`${label} instruction keys:`);
  tx.instructions.forEach((ix, i) => {
    console.log(`${i + 1}.`);
    ix.keys.forEach((k) => {
      console.log(
        `   ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`
      );
    });
  });

  return messageBase64;
}

async function simulateRawTransaction(rawTx) {
  const encodedTx = Buffer.from(rawTx).toString("base64");

  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        encodedTx,
        {
          encoding: "base64",
          sigVerify: true,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
        },
      ],
    }),
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `simulateTransaction RPC error: ${JSON.stringify(json.error ?? json)}`
    );
  }

  return json.result;
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
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(status.err)}`
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

  throw new Error(`Confirmation timeout: ${txSig}`);
}

async function main() {
  console.log("RPC:", RPC_URL);
  console.log("SEND_TX:", SEND_TX ? "YES" : "NO, dry-run only");
  console.log("");

  console.log("ComputeBudget:");
  console.log(
    "  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS:",
    COMPUTE_UNIT_PRICE_MICRO_LAMPORTS.toString()
  );
  console.log("  COMPUTE_UNIT_LIMIT:", COMPUTE_UNIT_LIMIT);
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

  const restoredMessageBase64 = dumpTransaction("restored", tx);

  if (EXPECTED_SIGNED_MESSAGE_BASE64) {
    console.log("");
    console.log(
      "restored message equals browser signed message:",
      restoredMessageBase64 === EXPECTED_SIGNED_MESSAGE_BASE64
    );

    if (restoredMessageBase64 !== EXPECTED_SIGNED_MESSAGE_BASE64) {
      console.log("");
      console.log("EXPECTED_SIGNED_MESSAGE_BASE64:");
      console.log(EXPECTED_SIGNED_MESSAGE_BASE64);
    }
  }

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
        "Server-restored transaction is not byte-identical to client signed transaction."
    );
  }

  const rawTx = tx.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });

  console.log("serialize OK");
  console.log("raw tx bytes:", rawTx.length);
  console.log("");

  console.log("Simulating raw transaction via RPC...");
  const sim = await simulateRawTransaction(rawTx);

  console.log("simulation err:", JSON.stringify(sim.value.err));
  console.log("simulation logs:");

  for (const line of sim.value.logs ?? []) {
    console.log("  ", line);
  }

  if (sim.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  console.log("Simulation OK");
  console.log("");

  if (!SEND_TX) {
    console.log("DRY RUN завершён.");
    console.log("");
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
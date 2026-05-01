import {
  PublicKey,
  Transaction,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferInstruction,
} from "./solana-wb.js";

const MESH_CHANNEL_SLOT = 7;
const MESH_BROADCAST_ADDR = 0xffffffff;

const SERVICE_FEE_SOL = "0.002";
const SERVICE_FEE_LAMPORTS = 2_000_000n;
const TX_FEE_RESERVE_LAMPORTS = 10_000n;

const TX_REPLY_TIMEOUT_MS = 180_000;

// devnet USDC mint.
// Для mainnet заменить на:
// EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

let solanaAddress = null;
let solanaProvider = null;

let transport = null;
let meshDevice = null;
let meshConnecting = false;
let meshConnected = false;
let meshSubscribed = false;
let meshSendQueue = Promise.resolve();

let awaitingInitReply = false;
let awaitingTxStatus = false;
let txReplyTimer = null;

let selectedToken = null;
const localEchoTexts = new Set();

let serverState = null;
/*
serverState = {
  solBalanceText,
  usdcBalanceText,
  solLamports,
  usdcUnits,
  nonceAccountAddress,
  nonceValue,
  serverFeeAddress,
  serverFrom,
  serverPacketId
}
*/

const $ = (id) => document.getElementById(id);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function log(msg, type = "info") {
  const el = $("log");
  const t = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.innerHTML = `${escapeHtml(t)} ${escapeHtml(msg)}`;
  div.className = `log-${type}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function errorToString(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;

  try {
    const obj = {};

    for (const k of Object.keys(e)) {
      obj[k] = e[k];
    }

    for (const k of Object.getOwnPropertyNames(e)) {
      obj[k] = e[k];
    }

    const json = JSON.stringify(obj);
    if (json && json !== "{}") return json;
  } catch {}

  try {
    return String(e);
  } catch {}

  return "Unknown object error";
}

function safeJson(value) {
  try {
    return JSON.stringify(
      value,
      (k, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    );
  } catch {
    return String(value);
  }
}

function isGattBusyError(e) {
  const msg = errorToString(e);
  return /GATT operation already in progress|operation already in progress/i.test(
    msg
  );
}

function isMeshPacketTimeoutError(e) {
  const msg = errorToString(e);

  return (
    e?.error === 3 ||
    /packet .* timed out/i.test(msg) ||
    /timed out/i.test(msg) ||
    /timeout/i.test(msg)
  );
}

function rememberLocalEcho(text) {
  localEchoTexts.add(text);
  setTimeout(() => localEchoTexts.delete(text), 8000);
}

function setSendStatus(text, type = "info") {
  const el = $("send-status");
  if (!el) return;

  el.style.display = "block";
  el.className = `info-row log-${type}`;
  el.textContent = text;
}

function setTransferStatus(text, type = "info") {
  const el = $("transfer-status");
  if (!el) return;

  el.style.display = "block";
  el.className = `info-row log-${type}`;
  el.textContent = text;
}

function getPacketFrom(packet) {
  return (
    packet?.from ??
    packet?.fromId ??
    packet?.fromNum ??
    packet?.from_num ??
    packet?.packet?.from ??
    packet?.packet?.fromId ??
    packet?.meshPacket?.from ??
    packet?.meshPacket?.fromId ??
    null
  );
}

function getPacketId(packet) {
  return (
    packet?.id ??
    packet?.packetId ??
    packet?.packet_id ??
    packet?.packet?.id ??
    packet?.meshPacket?.id ??
    null
  );
}

async function sendTextWithRetry(text, destination, channel, replyId) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await sleep(1200);

      const sendPromise = meshDevice.sendText(
        text,
        destination,
        false,
        channel,
        replyId
      );

      const earlyResult = await Promise.race([
        sendPromise
          .then(() => ({ status: "ack" }))
          .catch((e) => ({ status: "error", error: e })),
        sleep(1500).then(() => ({ status: "pending" })),
      ]);

      if (earlyResult.status === "error") {
        throw earlyResult.error;
      }

      if (earlyResult.status === "ack") {
        log(`Mesh ACK OK: ${text.slice(0, 80)}...`, "ok");

        return {
          queued: true,
          ack: true,
        };
      }

      sendPromise
        .then(() => {
          log(`Mesh ACK OK async: ${text.slice(0, 80)}...`, "ok");
        })
        .catch((e) => {
          const msg = errorToString(e);

          if (isMeshPacketTimeoutError(e)) {
            log(`Mesh ACK timeout async: ${msg}`, "err");
          } else {
            log(`Mesh send async error: ${msg}`, "err");
          }
        });

      return {
        queued: true,
        noAckWait: true,
      };
    } catch (e) {
      if (isGattBusyError(e) && attempt < 4) {
        log(`BLE busy, retry ${attempt}/4...`, "err");
        await sleep(1000 * attempt);
        continue;
      }

      throw e;
    }
  }

  throw new Error("Mesh send failed");
}

function sendTextQueued(text, destination, channel, replyId) {
  const job = meshSendQueue
    .catch(() => {})
    .then(() => sendTextWithRetry(text, destination, channel, replyId));

  meshSendQueue = job.catch(() => {});
  return job;
}

function normalizeDecimalInput(value) {
  return String(value).trim().replace(",", ".");
}

function parseDecimalToUnits(value, decimals) {
  const s = normalizeDecimalInput(value);

  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    throw new Error("Неверный формат суммы");
  }

  const [whole, fractionRaw = ""] = s.split(".");

  if (fractionRaw.length > decimals) {
    throw new Error(`Слишком много знаков после точки, максимум ${decimals}`);
  }

  const fraction = fractionRaw.padEnd(decimals, "0");
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");

  if (units <= 0n) {
    throw new Error("Сумма должна быть больше нуля");
  }

  return units;
}

function parsePublicKey(value, label) {
  try {
    return new PublicKey(String(value).trim());
  } catch {
    throw new Error(`${label}: неверный Solana-адрес`);
  }
}

function base58Encode(bytes) {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let x = 0n;

  for (const b of bytes) {
    x = (x << 8n) + BigInt(b);
  }

  let out = "";

  while (x > 0n) {
    const mod = Number(x % 58n);
    out = alphabet[mod] + out;
    x /= 58n;
  }

  for (const b of bytes) {
    if (b === 0) {
      out = "1" + out;
    } else {
      break;
    }
  }

  return out || "1";
}

function parseServerReply(text) {
  if (!text.startsWith("ST,")) return null;

  const fields = {};
  const parts = text.split(",").slice(1);

  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;

    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    fields[key] = value;
  }

  if (fields.e) {
    return {
      error: fields.e,
      solBalanceText: fields.S ?? "0",
      usdcBalanceText: fields.C ?? "0",
    };
  }

  if (!fields.S || !fields.C || !fields.a || !fields.v || !fields.p) {
    return null;
  }

  return {
    solBalanceText: fields.S,
    usdcBalanceText: fields.C,
    nonceAccountAddress: fields.a,
    nonceValue: fields.v,
    serverFeeAddress: fields.p,
  };
}

function parseTxHashReply(text) {
  if (!text.startsWith("ST,")) return null;

  const txHash = text.slice(3).trim();

  // Не путаем с init-ответами вида ST,S=...,C=...
  if (!txHash || txHash.includes(",") || txHash.includes("=")) {
    return null;
  }

  // Solana tx signature / tx hash в base58 обычно около 87-88 символов.
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(txHash)) {
    return null;
  }

  return txHash;
}

function txErrorText(code) {
  const map = {
    "3": "Ошибка отправки транзакции сервером",
    "4": "Сервер не знает mesh sender, нужен init",
    "5": "Nonce не найден или устарел",
    "6": "Неверная подпись клиента",
    "7": "Транзакция не подтверждена или timeout",
    "8": "Транзакция упала on-chain",
  };

  return map[String(code)] ?? `Ошибка сервера e=${code}`;
}

function clearTxReplyWait() {
  if (txReplyTimer) {
    clearTimeout(txReplyTimer);
    txReplyTimer = null;
  }
}

function startTxReplyWait() {
  clearTxReplyWait();

  txReplyTimer = setTimeout(() => {
    if (!awaitingTxStatus) return;

    awaitingTxStatus = false;
    $("transfer-send-btn").disabled = false;

    setTransferStatus(
      "Timeout: сервер не прислал подтверждённый tx_hash",
      "err"
    );

    log("Timeout ожидания confirmed TX от сервера", "err");
  }, TX_REPLY_TIMEOUT_MS);
}

function renderBalances() {
  if (!serverState) {
    $("balance-actions").hidden = true;
    $("transfer-form").hidden = true;
    return;
  }

  $("balance-actions").hidden = false;
  $("sol-balance-btn").textContent = `SOL: ${serverState.solBalanceText}`;
  $("usdc-balance-btn").textContent = `USDC: ${serverState.usdcBalanceText}`;
}

function selectToken(token) {
  if (!serverState) {
    setTransferStatus("Сначала получи ответ сервера с балансами и nonce", "err");
    return;
  }

  selectedToken = token;

  $("transfer-send-btn").disabled = false;
  $("transfer-form").hidden = false;
  $("transfer-title").textContent = `SEND ${token}`;
  $("receiver-input").value = "";
  $("amount-input").value = "";
  $("amount-input").placeholder = token === "SOL" ? "0.01" : "1.5";
  $("transfer-status").style.display = "none";
}

function validateTransferInput() {
  if (!solanaAddress) {
    throw new Error("Wallet не подключён");
  }

  if (!serverState) {
    throw new Error("Нет ответа сервера с nonce");
  }

  if (!selectedToken) {
    throw new Error("Не выбран токен");
  }

  const senderPk = parsePublicKey(solanaAddress, "sender");
  const receiverPk = parsePublicKey($("receiver-input").value, "receiver");
  const noncePk = parsePublicKey(serverState.nonceAccountAddress, "nonce account");
  const serverFeePubkey = parsePublicKey(
    serverState.serverFeeAddress,
    "server fee address"
  );

  const amountText = normalizeDecimalInput($("amount-input").value);
  const decimals = selectedToken === "SOL" ? 9 : 6;
  const amountUnits = parseDecimalToUnits(amountText, decimals);

  if (selectedToken === "SOL") {
    const required =
      amountUnits + SERVICE_FEE_LAMPORTS + TX_FEE_RESERVE_LAMPORTS;

    if (required > serverState.solLamports) {
      throw new Error(
        `Недостаточно SOL: сумма + ${SERVICE_FEE_SOL} SOL fee + reserve на tx fee больше баланса`
      );
    }
  }

  if (selectedToken === "USDC") {
    if (amountUnits > serverState.usdcUnits) {
      throw new Error("Недостаточно USDC");
    }

    const requiredSol = SERVICE_FEE_LAMPORTS + TX_FEE_RESERVE_LAMPORTS;

    if (requiredSol > serverState.solLamports) {
      throw new Error(
        `Недостаточно SOL для оплаты ${SERVICE_FEE_SOL} SOL service fee`
      );
    }
  }

  return {
    senderPk,
    receiverPk,
    noncePk,
    serverFeePubkey,
    amountText,
    amountUnits,
  };
}

function buildTransaction({
  senderPk,
  receiverPk,
  noncePk,
  serverFeePubkey,
  amountUnits,
}) {
  const tx = new Transaction({
    feePayer: senderPk,
    recentBlockhash: serverState.nonceValue,
  });

  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
    })
  );

  if (selectedToken === "SOL") {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPk,
        toPubkey: receiverPk,
        lamports: amountUnits,
      })
    );
  } else if (selectedToken === "USDC") {
    const mintPk = new PublicKey(USDC_MINT);

    const senderAta = getAssociatedTokenAddressSync(
      mintPk,
      senderPk,
      true,
      TOKEN_PROGRAM_ID
    );

    const receiverAta = getAssociatedTokenAddressSync(
      mintPk,
      receiverPk,
      true,
      TOKEN_PROGRAM_ID
    );

    tx.add(
      createTransferInstruction(
        senderAta,
        receiverAta,
        senderPk,
        amountUnits,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  } else {
    throw new Error(`Неизвестный токен: ${selectedToken}`);
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: senderPk,
      toPubkey: serverFeePubkey,
      lamports: SERVICE_FEE_LAMPORTS,
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

async function signAndSendTransfer() {
  try {
    $("transfer-send-btn").disabled = true;

    if (!meshDevice) {
      throw new Error("Mesh не подключён");
    }

    if (!solanaProvider?.signTransaction) {
      throw new Error("Wallet не поддерживает signTransaction");
    }

    if (serverState.serverFrom == null || serverState.serverPacketId == null) {
      throw new Error(
        "Не могу отправить reply: у серверного RX-пакета нет from/id.\n" +
          "Смотри строку RX packet debug в логе."
      );
    }

    const prepared = validateTransferInput();
    const tx = buildTransaction(prepared);

    setTransferStatus("Открой wallet и подпиши транзакцию", "info");

    const signedTx = await solanaProvider.signTransaction(tx);

    const sigEntry = signedTx.signatures.find((entry) =>
      entry.publicKey.equals(prepared.senderPk)
    );

    if (!sigEntry?.signature) {
      throw new Error("Wallet не вернул подпись sender");
    }

    const signature = base58Encode(sigEntry.signature);
    const receiver = prepared.receiverPk.toBase58();
    const token = selectedToken;
    const amount = prepared.amountText;

    const text = `ST,${receiver},${token},${amount},${signature}`;

    window.slotasticDebug = {
      signature,
      text,
      receiver,
      token,
      amount,
      sender: solanaAddress,
      nonceAccount: serverState.nonceAccountAddress,
      nonceValue: serverState.nonceValue,
      serverFeeAddress: serverState.serverFeeAddress,
      serverFrom: serverState.serverFrom,
      serverPacketId: serverState.serverPacketId,
      destination: MESH_BROADCAST_ADDR,
      channel: MESH_CHANNEL_SLOT,
    };

    console.log("slotastic signature =", signature);
    console.log("slotastic signature length =", signature.length);
    console.log("slotastic text =", text);
    console.log("slotastic text length =", text.length);
    console.log("slotastic debug =", window.slotasticDebug);

    rememberLocalEcho(text);
    awaitingTxStatus = true;
    startTxReplyWait();

    setTransferStatus(
      "Подпись отправляется серверу.\nЖдём confirmed tx_hash в slot 7...",
      "info"
    );

    log(`TX reply broadcast replyId=${serverState.serverPacketId}: ${text}`, "info");

    try {
      await sendTextQueued(
        text,
        MESH_BROADCAST_ADDR,
        MESH_CHANNEL_SLOT,
        serverState.serverPacketId
      );

      setTransferStatus(
        "Подпись отправлена.\nЖдём confirmed tx_hash от сервера...",
        "ok"
      );

      log(`TX reply отправлен broadcast replyId=${serverState.serverPacketId}: ${text}`, "ok");
    } catch (e) {
      const msg = errorToString(e);

      if (isMeshPacketTimeoutError(e)) {
        setTransferStatus(
          "Reply отправлен, но Mesh ACK timeout.\nЖдём confirmed tx_hash от сервера...",
          "info"
        );

        log(`Mesh ACK timeout для TX reply: ${msg}`, "err");
        return;
      }

      awaitingTxStatus = false;
      clearTxReplyWait();
      $("transfer-send-btn").disabled = false;

      throw e;
    }
  } catch (e) {
    const msg = errorToString(e);

    awaitingTxStatus = false;
    clearTxReplyWait();

    $("transfer-send-btn").disabled = false;
    setTransferStatus(msg, "err");
    log(msg, "err");
  }
}

// --- SOLANA ---

async function connectSolana() {
  const provider =
    window.phantom?.solana ??
    window.solana ??
    window.solflare ??
    window.backpack;

  if (!provider) {
    log("Wallet не найден", "err");
    return;
  }

  try {
    const resp = await provider.connect();

    solanaProvider = provider;
    solanaAddress = resp.publicKey.toString();

    $("sol-info").textContent = solanaAddress;
    $("sol-dot").className = "dot on";
    $("send-btn").disabled = false;
    $("sol-disconnect-btn").disabled = false;
    $("msg-input").value = `ST,init,${solanaAddress}`;

    log("Wallet подключён", "ok");
  } catch (e) {
    log(`Ошибка подключения wallet: ${errorToString(e)}`, "err");
  }
}

function disconnectSolana() {
  solanaAddress = null;
  solanaProvider = null;
  serverState = null;
  selectedToken = null;
  awaitingInitReply = false;
  awaitingTxStatus = false;
  clearTxReplyWait();

  $("sol-info").textContent = "Кошелёк не подключён";
  $("sol-dot").className = "dot";
  $("send-btn").disabled = true;
  $("sol-disconnect-btn").disabled = true;
  $("msg-input").value = "ST,init,";

  if ($("send-status")) {
    $("send-status").style.display = "none";
  }

  renderBalances();
  log("Wallet отключён", "info");
}

// --- MESH ---

function handleMeshMessage(packet) {
  const text = String(packet?.data ?? "").trim();

  if (!text) return;

  if (typeof packet.channel === "number" && packet.channel !== MESH_CHANNEL_SLOT) {
    return;
  }

  if (localEchoTexts.has(text)) {
    return;
  }

  log(`RX slot ${packet.channel ?? "?"}: ${text}`, "info");

  if (awaitingTxStatus && text.startsWith("ST,")) {
    const txHash = parseTxHashReply(text);

    if (txHash) {
      awaitingTxStatus = false;
      clearTxReplyWait();

      $("transfer-send-btn").disabled = false;

      setTransferStatus(`Транзакция подтверждена:\n${txHash}`, "ok");
      log(`Confirmed TX: ${txHash}`, "ok");

      window.slotasticLastTxHash = txHash;

      return;
    }

    const parsedTx = parseServerReply(text);

    if (parsedTx?.error) {
      awaitingTxStatus = false;
      clearTxReplyWait();

      $("transfer-send-btn").disabled = false;

      const msg = txErrorText(parsedTx.error);

      setTransferStatus(msg, "err");
      log(msg, "err");

      return;
    }

    // Если это init-ответ вида ST,S=...,C=...,a=...,v=...,p=...
    // не считаем его TX-ответом, пусть обработается ниже.
    if (!parsedTx) {
      awaitingTxStatus = false;
      clearTxReplyWait();

      $("transfer-send-btn").disabled = false;

      setTransferStatus(`Непонятный ответ сервера:\n${text}`, "err");
      log(`Unexpected TX reply: ${text}`, "err");

      return;
    }
  }

  const parsed = parseServerReply(text);

  if (parsed?.error) {
    awaitingInitReply = false;
    $("send-btn").disabled = false;

    setSendStatus(
      `Ошибка сервера e=${parsed.error}; SOL=${parsed.solBalanceText}, USDC=${parsed.usdcBalanceText}`,
      "err"
    );

    return;
  }

  if (parsed) {
    try {
      parsePublicKey(parsed.nonceAccountAddress, "nonce account");
      parsePublicKey(parsed.serverFeeAddress, "server fee address");

      const serverFrom = getPacketFrom(packet);
      const serverPacketId = getPacketId(packet);

      if (serverFrom == null || serverPacketId == null) {
        log(`RX packet debug: ${safeJson(packet)}`, "err");
      }

      serverState = {
        ...parsed,
        solLamports: parseDecimalToUnits(parsed.solBalanceText, 9),
        usdcUnits: parseDecimalToUnits(parsed.usdcBalanceText, 6),
        serverFrom,
        serverPacketId,
      };

      log(`Reply target: from=${serverFrom ?? "?"}, id=${serverPacketId ?? "?"}`, "info");

      awaitingInitReply = false;
      $("send-btn").disabled = false;

      $("sol-info").textContent =
        `${solanaAddress}\n` +
        `SOL: ${serverState.solBalanceText}\n` +
        `USDC: ${serverState.usdcBalanceText}\n` +
        `nonce: ${serverState.nonceAccountAddress}\n` +
        `blockhash: ${serverState.nonceValue}\n` +
        `server fee: ${serverState.serverFeeAddress}`;

      renderBalances();

      setSendStatus("Ответ сервера получен.\nБалансы доступны в Wallet.", "ok");
      log("Баланс и durable nonce получены", "ok");
    } catch (e) {
      const msg = errorToString(e);
      setSendStatus(msg, "err");
      log(msg, "err");
    }

    return;
  }
}

async function connectMesh() {
  if (meshConnecting || meshConnected || meshDevice) {
    log("Mesh уже подключён или подключается", "info");
    return;
  }

  meshConnecting = true;
  $("mesh-connect-btn").disabled = true;

  try {
    const mod = await import("./meshtastic-wb.js");

    const Transport = mod.TransportWebBluetooth;
    const MeshDevice = mod.MeshDevice;

    transport = await Transport.create();
    meshDevice = new MeshDevice(transport);

    window.meshDevice = meshDevice;
    window.meshTransport = transport;

    if (!meshSubscribed) {
      meshDevice.events.onMessagePacket.subscribe(handleMeshMessage);
      meshSubscribed = true;
    }

    meshConnected = true;

    $("mesh-dot").className = "dot on";
    $("mesh-info").textContent = "Нода подключена";

    log("Mesh подключён", "ok");

    meshDevice.configure().catch((e) => {
      log(`Mesh configure warning: ${errorToString(e)}`, "err");
    });
  } catch (e) {
    transport = null;
    meshDevice = null;
    meshConnected = false;
    meshSubscribed = false;

    $("mesh-connect-btn").disabled = false;

    log(`Ошибка подключения BLE: ${errorToString(e)}`, "err");
  } finally {
    meshConnecting = false;
  }
}

// --- SEND INIT ---

async function sendInit() {
  if (!meshDevice) {
    log("Mesh не подключён", "err");
    return;
  }

  if (!solanaAddress) {
    log("Нет wallet", "err");
    return;
  }

  const text = `ST,init,${solanaAddress}`;

  window.slotasticInitDebug = {
    text,
    wallet: solanaAddress,
    channel: MESH_CHANNEL_SLOT,
    destination: MESH_BROADCAST_ADDR,
  };

  console.log("slotastic init text =", text);
  console.log("slotastic init debug =", window.slotasticInitDebug);

  rememberLocalEcho(text);

  $("msg-input").value = text;
  awaitingInitReply = true;
  $("send-btn").disabled = true;

  setSendStatus("Init отправляется.\nЖдём ответ сервера в slot 7...", "info");
  log(`TX init: ${text}`, "info");

  try {
    await sendTextQueued(text, MESH_BROADCAST_ADDR, MESH_CHANNEL_SLOT);

    setSendStatus("Init отправлен.\nЖдём ответ сервера в slot 7...", "info");
    log(`Отправлено: ${text}`, "ok");
  } catch (e) {
    const msg = errorToString(e);

    if (isMeshPacketTimeoutError(e)) {
      log(`Mesh ACK timeout для init: ${msg}`, "err");

      if (serverState) {
        setSendStatus("Init дошёл: ответ сервера уже получен, ACK timeout игнорируем.", "ok");
        $("send-btn").disabled = false;
        awaitingInitReply = false;
      } else {
        setSendStatus("Init отправлен, но ACK timeout.\nВсё ещё ждём ответ сервера...", "info");
      }

      return;
    }

    awaitingInitReply = false;
    $("send-btn").disabled = false;

    log(`Ошибка отправки init: ${msg}`, "err");
    setSendStatus(`Ошибка отправки init: ${msg}`, "err");
  }
}

// --- UI ---

$("sol-connect-btn").onclick = connectSolana;
$("sol-disconnect-btn").onclick = disconnectSolana;
$("mesh-connect-btn").onclick = connectMesh;
$("send-btn").onclick = sendInit;

$("sol-balance-btn").onclick = () => selectToken("SOL");
$("usdc-balance-btn").onclick = () => selectToken("USDC");
$("transfer-send-btn").onclick = signAndSendTransfer;

$("clear-log-btn").onclick = () => {
  $("log").innerHTML = "";
};

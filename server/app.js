const MESH_CHANNEL_SLOT = 7;
const MESH_BROADCAST_ADDR = 0xffffffff;
const API_BASE = "http://localhost:8787";

let transport = null;
let meshDevice = null;
let meshModule = null;
let myNodeNum = null;

const recentlyHandled = new Map();

const $ = (id) => document.getElementById(id);

function nowMs() {
  return Date.now();
}

function errText(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;

  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function compactJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function log(msg, type = "info") {
  const el = $("log");
  if (!el) return;

  const t = new Date().toLocaleTimeString();

  const div = document.createElement("div");
  div.className = "log-entry";

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = t;

  const text = document.createElement("span");
  text.className = `log-${type}`;
  text.textContent = String(msg);

  div.append(time, text);
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  const el = $("log");
  if (el) el.innerHTML = "";
}

function setMonitor(text) {
  const el = $("monitor-info");
  if (el) el.textContent = text;
}

function normalizeNodeNum(v) {
  if (v === undefined || v === null || v === "") return null;

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isOwnNode(num) {
  return myNodeNum !== null && normalizeNodeNum(num) === myNodeNum;
}

function decodeMaybeBytes(v) {
  if (!v) return "";

  if (typeof v === "string") {
    return v.trim();
  }

  if (v instanceof Uint8Array) {
    return new TextDecoder().decode(v).trim();
  }

  if (Array.isArray(v)) {
    return new TextDecoder().decode(new Uint8Array(v)).trim();
  }

  if (v.payload instanceof Uint8Array) {
    return new TextDecoder().decode(v.payload).trim();
  }

  if (Array.isArray(v.payload)) {
    return new TextDecoder().decode(new Uint8Array(v.payload)).trim();
  }

  return "";
}

function extractText(pkt) {
  return (
    decodeMaybeBytes(pkt?.data) ||
    decodeMaybeBytes(pkt?.message) ||
    decodeMaybeBytes(pkt?.payload) ||
    decodeMaybeBytes(pkt?.decoded?.payload) ||
    decodeMaybeBytes(pkt?.packet?.decoded?.payload) ||
    decodeMaybeBytes(pkt?.meshPacket?.decoded?.payload) ||
    decodeMaybeBytes(pkt?.payloadVariant?.value?.decoded?.payload) ||
    decodeMaybeBytes(pkt?.payloadVariant?.value?.payload) ||
    ""
  ).trim();
}

function extractChannel(pkt) {
  const ch =
    pkt?.channel ??
    pkt?.channelIndex ??
    pkt?.channel_index ??
    pkt?.packetMetadata?.channel ??
    pkt?.packetMetadata?.channelIndex ??
    pkt?.packet?.channel ??
    pkt?.meshPacket?.channel ??
    pkt?.decoded?.channel ??
    pkt?.payloadVariant?.value?.channel;

  const n = Number(ch);
  return Number.isFinite(n) ? n : null;
}

function extractFrom(pkt) {
  return normalizeNodeNum(
    pkt?.from ??
      pkt?.fromNode ??
      pkt?.from_node ??
      pkt?.packetMetadata?.from ??
      pkt?.packetMetadata?.fromNode ??
      pkt?.packet?.from ??
      pkt?.meshPacket?.from ??
      pkt?.payloadVariant?.value?.from
  );
}

function extractPacketId(pkt) {
  const id =
    pkt?.id ??
    pkt?.packet?.id ??
    pkt?.meshPacket?.id ??
    pkt?.packetMetadata?.id ??
    pkt?.decoded?.requestId ??
    pkt?.payloadVariant?.value?.id;

  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseInit(text) {
  const m = /^ST,init,([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(text.trim());
  return m?.[1] ?? null;
}

function parseTx(text) {
  const m =
    /^ST,([1-9A-HJ-NP-Za-km-z]{32,44}),(SOL|USDC),([0-9]+(?:[.,][0-9]+)?),([1-9A-HJ-NP-Za-km-z]{80,100})$/.exec(
      text.trim()
    );

  if (!m) return null;

  return {
    receiver: m[1],
    token: m[2],
    amount: m[3].replace(",", "."),
    signature: m[4],
  };
}

function isDuplicate(fromNode, text) {
  const key = `${fromNode ?? "?"}:${text}`;
  const t = nowMs();
  const old = recentlyHandled.get(key);

  recentlyHandled.set(key, t);

  for (const [k, ts] of recentlyHandled.entries()) {
    if (t - ts > 10000) {
      recentlyHandled.delete(k);
    }
  }

  return old && t - old < 5000;
}

async function loadMeshtasticModule() {
  const mod = await import("./meshtastic-wb.js");

  meshModule = mod;

  log(
    `Loaded ./meshtastic-wb.js exports: ${
      Object.keys(mod).join(", ") || "(no named exports)"
    }`,
    "info"
  );

  return mod;
}

function pickExport(mod, names) {
  for (const name of names) {
    if (mod?.[name]) return mod[name];
    if (mod?.default?.[name]) return mod.default[name];
  }

  return null;
}

function canSendText() {
  return !!(
    meshDevice?.sendText ||
    meshDevice?.sendTextMessage ||
    transport?.send ||
    transport?.sendPacket ||
    transport?.write
  );
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(
      `HTTP ${res.status}: ${data ? compactJson(data) : res.statusText}`
    );

    err.status = res.status;
    err.data = data;

    throw err;
  }

  return data;
}

async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();

    $("backend-dot").className = "dot on";
    $("backend-info").textContent =
      `OK\n` +
      `RPC: ${data.rpc}\n` +
      `Server fee address: ${data.serverFeeAddress}\n` +
      `Server SOL: ${data.serverSol}\n` +
      `USDC mint: ${data.usdcMint}\n` +
      `Service fee lamports: ${data.serviceFeeLamports}\n` +
      `Compute unit price: ${data.computeUnitPriceMicroLamports}\n` +
      `Compute unit limit: ${data.computeUnitLimit}`;

    log("✓ Backend доступен", "ok");
  } catch (e) {
    $("backend-dot").className = "dot err";
    $("backend-info").textContent = `Backend недоступен: ${errText(e)}`;
    log(`Backend error: ${errText(e)}`, "err");
  }
}

async function connectMesh() {
  const btn = $("mesh-connect-btn");

  btn.disabled = true;
  btn.textContent = "⏳ Подключение…";

  if (!window.isSecureContext) {
    log("Web Bluetooth работает только через https:// или http://localhost.", "err");

    btn.disabled = false;
    btn.textContent = "⬡ Подключить BLE";
    $("mesh-dot").className = "dot err";

    return;
  }

  if (!navigator.bluetooth) {
    log("navigator.bluetooth недоступен. Используй Chrome/Edge.", "err");

    btn.disabled = false;
    btn.textContent = "⬡ Подключить BLE";
    $("mesh-dot").className = "dot err";

    return;
  }

  try {
    log("Попытка подключения к Meshtastic BLE…", "info");

    const mod = await loadMeshtasticModule();

    const TransportWebBluetooth = pickExport(mod, [
      "TransportWebBluetooth",
      "WebBluetoothTransport",
    ]);

    const MeshDevice = pickExport(mod, ["MeshDevice"]);

    if (!TransportWebBluetooth) {
      throw new Error("В meshtastic-wb.js не найден TransportWebBluetooth.");
    }

    if (!MeshDevice) {
      throw new Error("В meshtastic-wb.js не найден MeshDevice.");
    }

    if (typeof TransportWebBluetooth.create === "function") {
      transport = await TransportWebBluetooth.create();
    } else {
      transport = new TransportWebBluetooth();
      await transport.connect?.();
    }

    meshDevice = new MeshDevice(transport);

    attachMeshEvents(meshDevice);

    const devInfo =
      transport.device?.name ??
      transport.device?.id ??
      transport.bluetoothDevice?.name ??
      transport.bluetoothDevice?.id ??
      "Meshtastic BLE";

    $("mesh-dot").className = "dot on";
    $("mesh-disconnect-btn").disabled = false;
    $("mesh-connect-btn").textContent = "Подключено";

    $("mesh-info").textContent =
      `BLE: ${devInfo}\n` +
      `TX/RX channel slot: ${MESH_CHANNEL_SLOT}\n` +
      `Отправка: ${canSendText() ? "доступна" : "не найдена"}`;

    setMonitor(
      `Мониторю Meshtastic slot ${MESH_CHANNEL_SLOT}.\n` +
        `Жду сообщения вида ST,init,<wallet> или ST,<receiver>,<token>,<amount>,<signature>`
    );

    log("✓ Transport подключён. MeshDevice создан.", "ok");

    if (typeof meshDevice.configure === "function") {
      log("configure() запущен в фоне.", "info");

      meshDevice
        .configure()
        .then(() => log("✓ configure() завершён.", "ok"))
        .catch((e) => log(`⚠ configure() ошибка: ${errText(e)}`, "warn"));
    }
  } catch (e) {
    log(`Ошибка подключения Meshtastic: ${errText(e)}`, "err");

    btn.disabled = false;
    btn.textContent = "⬡ Подключить BLE";
    $("mesh-dot").className = "dot err";

    setMonitor(`Ошибка BLE: ${errText(e)}`);
  }
}

function attachMeshEvents(device) {
  try {
    device.events?.onMessagePacket?.subscribe?.((pkt) => {
      handlePossibleMessage(pkt, "onMessagePacket");
    });

    device.events?.onFromRadio?.subscribe?.((pkt) => {
      const caseName = pkt?.payloadVariant?.case ?? "unknown";
      const value = pkt?.payloadVariant?.value;

      if (caseName === "queueStatus") {
        log(`RX fromRadio: queueStatus ${compactJson(value)}`, "info");
      } else {
        log(`RX fromRadio: ${caseName}`, "info");
      }

      if (caseName === "myInfo") {
        myNodeNum = normalizeNodeNum(
          value?.myNodeNum ?? value?.nodeNum ?? value?.node_num
        );

        if (myNodeNum !== null) {
          log(`My node number: ${myNodeNum}`, "ok");
        }
      }

      if (caseName === "packet" && value) {
        handlePossibleMessage(value, "onFromRadio.packet");
      }
    });

    device.events?.onDeviceStatus?.subscribe?.((s) => {
      log(`Status: ${compactJson(s)}`, "info");
    });
  } catch (e) {
    log(`Не удалось подписаться на events: ${errText(e)}`, "err");
  }
}

async function handlePossibleMessage(pkt, source) {
  const text = extractText(pkt);
  if (!text) return;

  const channel = extractChannel(pkt);
  const fromNode = extractFrom(pkt);
  const packetId = extractPacketId(pkt);

  if (channel !== null && channel !== MESH_CHANNEL_SLOT) {
    return;
  }

  if (isOwnNode(fromNode)) {
    return;
  }

  const wallet = parseInit(text);
  const tx = parseTx(text);

  if (!wallet && !tx) {
    log(`RX ${source}: ${text}`, "info");
    return;
  }

  if (isDuplicate(fromNode, text)) {
    return;
  }

  if (wallet) {
    log(
      `RX ST init from=${fromNode ?? "?"}, channel=${
        channel ?? "?"
      }, packetId=${packetId ?? "-"}: ${wallet}`,
      "ok"
    );

    setMonitor(
      `Получен init от node=${fromNode ?? "?"}\n` +
        `Wallet: ${wallet}\n` +
        `Проверяю баланс SOL/USDC…`
    );

    try {
      const data = await postJson(`${API_BASE}/api/init`, {
        wallet,
        fromNode,
        packetId,
      });

      if (!data?.response) {
        throw new Error(`Backend returned no response: ${compactJson(data)}`);
      }

      log(`Backend response: ${data.response}`, "ok");

      setMonitor(
        `Backend ответил:\n${data.response}\n` +
          `Отправляю reply в Meshtastic slot ${MESH_CHANNEL_SLOT}…`
      );

      await sendReply(data.response, packetId);

      setMonitor(`Ответ поставлен в очередь:\n${data.response}`);
    } catch (e) {
      const errResponse = e?.data?.response ?? "ST,S=0,C=0,e=2";

      log(`Ошибка обработки ST init: ${errText(e)}`, "err");
      setMonitor(`Ошибка обработки init:\n${errText(e)}\nОтправляю ${errResponse}`);

      try {
        await sendReply(errResponse, packetId);
      } catch (sendErr) {
        log(`Не удалось отправить ошибку init клиенту: ${errText(sendErr)}`, "err");
      }
    }

    return;
  }

  if (tx) {
    log(
      `RX ST tx from=${fromNode ?? "?"}, channel=${
        channel ?? "?"
      }, packetId=${packetId ?? "-"}: receiver=${tx.receiver}, token=${
        tx.token
      }, amount=${tx.amount}`,
      "ok"
    );

    log("1/3 recreate transaction: отправляю данные в backend /api/submit", "info");

    log(
      `TX metadata: fromNode=${fromNode ?? "?"}, receiver=${tx.receiver}, token=${
        tx.token
      }, amount=${tx.amount}, signatureLen=${tx.signature.length}`,
      "info"
    );

    setMonitor(
      `Получена подпись от node=${fromNode ?? "?"}\n` +
        `1/3 recreate transaction…\n` +
        `receiver=${tx.receiver}\n` +
        `token=${tx.token}, amount=${tx.amount}`
    );

    try {
      log("2/3 check signature: backend восстановит tx и проверит подпись", "info");
      log("3/3 send to RPC node: backend отправит tx и дождётся confirmed", "info");

      const data = await postJson(`${API_BASE}/api/submit`, {
        fromNode,
        receiver: tx.receiver,
        token: tx.token,
        amount: tx.amount,
        signature: tx.signature,
      });

      if (!data?.response) {
        throw new Error(`Backend returned no response: ${compactJson(data)}`);
      }

      if (data.ok) {
        log(`Backend submit confirmed: ${data.response}`, "ok");

        setMonitor(
          `Транзакция confirmed:\n${data.txSig ?? data.response}\n` +
            `Отправляю клиенту:\n${data.response}`
        );
      } else {
        log(`Backend submit error: ${compactJson(data)}`, "err");
        setMonitor(`Backend submit error:\n${compactJson(data)}`);
      }

      await sendReply(data.response, packetId);

      log(
        `TX hash/error отправлен клиенту: ${data.response}`,
        data.ok ? "ok" : "err"
      );
    } catch (e) {
      const errResponse = e?.data?.response ?? "ST,e=3";

      log(`Ошибка обработки ST tx: ${errText(e)}`, "err");

      setMonitor(
        `Ошибка обработки tx:\n${errText(e)}\nОтправляю ${errResponse}`
      );

      try {
        await sendReply(errResponse, packetId);
      } catch (sendErr) {
        log(`Не удалось отправить ошибку клиенту: ${errText(sendErr)}`, "err");
      }
    }

    return;
  }
}

async function sendReply(text, replyId) {
  if (!meshDevice && !transport) {
    throw new Error("Meshtastic не подключён.");
  }

  const dst = MESH_BROADCAST_ADDR;
  let sendPromise;

  if (typeof meshDevice?.sendText === "function") {
    sendPromise = meshDevice.sendText(
      text,
      dst,
      false,
      MESH_CHANNEL_SLOT,
      replyId
    );

    log(
      `TX channel reply через MeshDevice.sendText(): "${text}" → broadcast, slot ${MESH_CHANNEL_SLOT}, replyId=${
        replyId ?? "-"
      }`,
      "info"
    );
  } else if (typeof transport?.sendPacket === "function") {
    sendPromise = transport.sendPacket({
      to: dst,
      payload: new TextEncoder().encode(text),
      portnum: 1,
      channel: MESH_CHANNEL_SLOT,
      replyId,
    });

    log(
      `TX channel reply через transport.sendPacket(): "${text}" → broadcast, slot ${MESH_CHANNEL_SLOT}, replyId=${
        replyId ?? "-"
      }`,
      "info"
    );
  } else if (typeof meshDevice?.sendTextMessage === "function") {
    sendPromise = meshDevice.sendTextMessage(text);
    log(`TX reply через MeshDevice.sendTextMessage(): "${text}"`, "info");
  } else if (typeof transport?.send === "function") {
    sendPromise = transport.send(text);
    log(`TX reply через transport.send(): "${text}"`, "info");
  } else if (typeof transport?.write === "function") {
    sendPromise = transport.write(new TextEncoder().encode(text));
    log(`TX reply через transport.write(): "${text}"`, "info");
  } else {
    throw new Error("Нет доступного метода отправки.");
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  sendPromise?.catch?.((e) => {
    const s = errText(e);

    if (s.includes('"error":3') || s.includes("error:3")) {
      log(`Статус после broadcast: ${s}`, "info");
      return;
    }

    log(`Поздний ответ sendText(): ${s}`, "warn");
  });

  log(`✓ Ответ поставлен в очередь в канал: "${text}"`, "ok");
}

async function disconnectMesh() {
  try {
    await meshDevice?.disconnect?.();
    await transport?.disconnect?.();
  } catch (_) {
  } finally {
    transport = null;
    meshDevice = null;
    myNodeNum = null;

    $("mesh-info").textContent = "Нода не подключена";
    $("mesh-dot").className = "dot";
    $("mesh-disconnect-btn").disabled = true;
    $("mesh-connect-btn").disabled = false;
    $("mesh-connect-btn").textContent = "⬡ Подключить BLE";

    setMonitor("Жду подключения Meshtastic BLE…");
    log("Meshtastic отключён вручную.", "warn");
  }
}

async function debugServices() {
  log(
    `Module exports: ${
      meshModule ? Object.keys(meshModule).join(", ") : "module not loaded"
    }`,
    "info"
  );

  if (transport) {
    log(`Transport keys: ${Object.keys(transport).join(", ") || "(none)"}`, "info");
  }

  if (meshDevice) {
    log(
      `MeshDevice keys: ${Object.keys(meshDevice).join(", ") || "(none)"}`,
      "info"
    );

    const proto = Object.getPrototypeOf(meshDevice);

    log(
      `MeshDevice proto methods: ${Object.getOwnPropertyNames(proto).join(", ")}`,
      "info"
    );
  }
}

function attachUI() {
  $("backend-check-btn")?.addEventListener("click", checkBackend);
  $("mesh-connect-btn")?.addEventListener("click", connectMesh);
  $("mesh-disconnect-btn")?.addEventListener("click", disconnectMesh);
  $("mesh-debug-btn")?.addEventListener("click", debugServices);
  $("clear-log-btn")?.addEventListener("click", clearLog);

  checkBackend();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachUI);
} else {
  attachUI();
}
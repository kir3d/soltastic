import {
  HARDWARE_MODEL,
  DEVICE_ROLE,
  LORA_REGION,
  enumName,
} from "./meshtastic-constants.js";

const MESH_CHANNEL_SLOT = 7;
const MESH_BROADCAST_ADDR = 0xffffffff;

let solanaAddress = null;
let transport = null;
let meshDevice = null;

const $ = (id) => document.getElementById(id);

function log(msg, type = "info") {
  const el = $("log");
  const t = new Date().toLocaleTimeString();

  const div = document.createElement("div");
  div.innerHTML = `<span class="log-time">${t}</span> <span class="log-${type}">${msg}</span>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
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
    solanaAddress = resp.publicKey.toString();

    $("sol-info").textContent = solanaAddress;
    $("sol-dot").className = "dot on";
    $("send-btn").disabled = false;

    $("msg-input").value = `ST,init,${solanaAddress}`;

    log("Wallet подключён", "ok");

  } catch (e) {
    log("Ошибка подключения wallet", "err");
  }
}

function disconnectSolana() {
  solanaAddress = null;

  $("sol-info").textContent = "Кошелёк не подключён";
  $("sol-dot").className = "dot";
  $("send-btn").disabled = true;

  $("msg-input").value = "ST,init,<wallet>";
}

// --- MESH ---

async function connectMesh() {
  try {
    const mod = await import("./meshtastic-wb.js");

    const Transport = mod.TransportWebBluetooth;
    const MeshDevice = mod.MeshDevice;

    transport = await Transport.create();
    meshDevice = new MeshDevice(transport);

    $("mesh-dot").className = "dot on";

    log("Mesh подключён", "ok");

    meshDevice.configure();

  } catch (e) {
    log("Ошибка подключения BLE", "err");
  }
}

// --- SEND ---

async function sendPing() {
  if (!meshDevice) {
    log("Mesh не подключён", "err");
    return;
  }

  if (!solanaAddress) {
    log("Нет wallet", "err");
    return;
  }

  const text = `ST,init,${solanaAddress}`;

  $("msg-input").value = text;

  try {
    await meshDevice.sendText(
      text,
      MESH_BROADCAST_ADDR,
      false,
      MESH_CHANNEL_SLOT
    );

    log(`Отправлено: ${text}`, "ok");

  } catch (e) {
    log("Ошибка отправки", "err");
  }
}

// --- UI ---

$("sol-connect-btn").onclick = connectSolana;
$("sol-disconnect-btn").onclick = disconnectSolana;
$("mesh-connect-btn").onclick = connectMesh;
$("send-btn").onclick = sendPing;
$("clear-log-btn").onclick = () => $("log").innerHTML = "";

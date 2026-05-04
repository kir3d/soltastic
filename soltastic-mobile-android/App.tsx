import { PublicKey } from '@solana/web3.js'; import React, { useCallback, useRef, useState, useEffect } from 'react'; import {   ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, TouchableOpacity, } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as NavigationBar from 'expo-navigation-bar';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { Types } from '@meshtastic/core';
import { BleDeviceInfo, MeshClient } from './src/mesh/MeshClient';
import { connectWallet, disconnectWallet, signTransactionWithWallet, WalletSession, reconnectWallet } from './src/wallet/mobileWallet';
import { parseServerReply,
  parseTxHashReply,
  txErrorText } from './src/protocol/parse';
import {
  buildSoltasticTransaction,
  extractSenderSignature,
  validateTransferInput as prepareSoltasticTransfer
} from './src/solana/transactions';
import { MESH_CHANNEL_SLOT, SERVICE_FEE_SOL } from './src/constants';
import type { LogLevel, LogLine, ServerState, TokenSymbol } from './src/types';
import { parseDecimalToUnits } from './src/utils/decimal';
import { parsePublicKey } from './src/utils/address';

function shortAddress(address: string | null): string {
  if (!address) return 'Not connected';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function getPacketFrom(packet: Types.PacketMetadata<string>): number | null {
  const p = packet as any;
  return p?.from ?? p?.fromId ?? p?.fromNum ?? p?.from_num ?? null;
}

function getPacketId(packet: Types.PacketMetadata<string>): number | null {
  const p = packet as any;
  return p?.id ?? p?.packetId ?? p?.packet_id ?? null;
}


function extractSolanaAddressFromQr(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const candidates: string[] = [];

  candidates.push(text);

  if (text.toLowerCase().startsWith('solana:')) {
    candidates.push(text.slice('solana:'.length).split('?')[0]);
  }

  try {
    const url = new URL(text);
    const queryCandidates = [
      url.searchParams.get('recipient'),
      url.searchParams.get('receiver'),
      url.searchParams.get('address'),
      url.searchParams.get('wallet'),
      url.searchParams.get('pubkey'),
    ];

    for (const item of queryCandidates) {
      if (item) candidates.push(item);
    }

    const pathCandidate = url.pathname.split('/').filter(Boolean).pop();
    if (pathCandidate) candidates.push(pathCandidate);
  } catch {
    // Not a URL. Try regex below.
  }

  const base58Matches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [];
  candidates.push(...base58Matches);

  for (const item of candidates) {
    const cleaned = item.trim().replace(/^solana:/i, '').split('?')[0];
    try {
      parsePublicKey(cleaned, 'QR receiver address');
      return cleaned;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}



function txHashFromStatus(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = value.match(/(?:TX HASH|tx_hash|Transaction hash)\s*:\s*([1-9A-HJ-NP-Za-km-z]{64,110})/);
  if (match?.[1]) return match[1];

  if (/^[1-9A-HJ-NP-Za-km-z]{64,110}$/.test(value.trim())) {
    return value.trim();
  }

  return null;
}

function errorToText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const anyError = error as any;

    if (typeof anyError.message === 'string') {
      return anyError.message;
    }

    if (typeof anyError.error === 'string') {
      return anyError.error;
    }

    if (typeof anyError.reason === 'string') {
      return anyError.reason;
    }

    if (typeof anyError.code !== 'undefined') {
      try {
        return `code=${String(anyError.code)} ${JSON.stringify(error)}`;
      } catch {
        return `code=${String(anyError.code)}`;
      }
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function isSubmitStylePacket(text: string): boolean {
  // Client submit looks like:
  // ST,<receiver>,<token>,<amount>,<signature>
  const parts = text.split(',');
  if (parts.length < 5) return false;
  if (parts[0] !== 'ST') return false;
  if (parts[2] !== 'SOL' && parts[2] !== 'USDC') return false;
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(parts[3])) return false;
  return true;
}

function Button(props: {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { title, onPress, disabled, variant = 'primary' } = props;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : variant === 'secondary' ? styles.buttonSecondary : styles.buttonDanger,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function TokenButton(props: {
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.tokenButton, props.selected ? styles.tokenSelected : null]}
    >
      <Text style={styles.tokenText}>{props.title}</Text>
    </Pressable>
  );
}


function txHashFromStatusPanel(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = value.match(/(?:TX HASH|tx_hash|Transaction hash)\s*:\s*([1-9A-HJ-NP-Za-km-z]{64,110})/);
  if (match?.[1]) return match[1];

  const trimmed = value.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{64,110}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function StatusPanel({ status }: { status: string }) {
  const txHash = txHashFromStatusPanel(status);

  return (
    <View style={styles.statusPane}>
      <View style={styles.statusHeaderRow}>
        <Text style={styles.sectionTitle}>Status</Text>
      </View>

      <ScrollView style={styles.statusScroll} contentContainerStyle={styles.statusScrollContent}>
        <Text
          selectable
          style={[
            styles.statusText,
            txHash ? styles.statusTextOk : null,
          ]}
        >
          {status || 'Waiting for action...'}
        </Text>
      </ScrollView>
    </View>
  );
}



function statusTxHash(value: string | null | undefined): string | null {
  if (!value) return null;

  const m = value.match(/(?:TX HASH|tx_hash|Transaction hash)\s*:\s*([1-9A-HJ-NP-Za-km-z]{64,110})/);
  if (m?.[1]) return m[1];

  const trimmed = value.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{64,110}$/.test(trimmed)) return trimmed;

  return null;
}

function StatusPanelInline({ status }: { status: string }) {
  const txHash = statusTxHash(status);

  return (
    <View style={styles.statusInline}>
      <View style={styles.statusInlineHeader}>
        <Text style={styles.statusInlineTitle}>Status</Text>
      </View>

      <Text
        selectable
        numberOfLines={3}
        style={[
          styles.statusInlineText,
          txHash ? styles.statusInlineTextOk : null,
        ]}
      >
        {status || 'Waiting for action...'}
      </Text>
    </View>
  );
}



function shortMiddle(value: string, left = 8, right = 8): string {
  if (!value) return '';
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function getDurableNonceValue(state: unknown): string | null {
  const anyState = state as any;
  if (!anyState || typeof anyState !== 'object') return null;

  const candidates = [
    anyState.durableNonce,
    anyState.durable_nonce,
    anyState.nonce,
    anyState.nonceValue,
    anyState.nonce_value,
    anyState.blockhash,
    anyState.recentBlockhash,
    anyState.recent_blockhash,
    anyState.v,
  ];

  const found = candidates.find((value) => typeof value === 'string' && value.length > 0);
  return found ?? null;
}


function countDecimalsLegacy1(value: string): number {
  const clean = value.trim();
  if (!clean.includes('.')) return 0;
  return clean.split('.')[1]?.length ?? 0;
}

function validateTransferInputLegacy1(
  receiverAddress: string,
  amountText: string,
  selectedToken: string,
): string | null {
  const address = receiverAddress.trim();

  if (!address) {
    return 'Receiver address is required.';
  }

  try {
    const pubkey = new PublicKey(address);

    if (pubkey.toBase58() !== address) {
      return 'Receiver address is not a valid Solana base58 address.';
    }
  } catch {
    return 'Receiver address is not a valid Solana address.';
  }

  const cleanAmount = amountText.trim();

  if (!cleanAmount) {
    return 'Amount is required.';
  }

  if (!/^\d+(\.\d+)?$/.test(cleanAmount)) {
    return 'Amount must be a positive decimal number.';
  }

  const amount = Number(cleanAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Amount must be greater than 0.';
  }

  const token = selectedToken === 'USDC' ? 'USDC' : 'SOL';
  const decimals = token === 'USDC' ? 6 : 9;

  if (countDecimals(cleanAmount) > decimals) {
    return `${token} amount supports maximum ${decimals} decimal places.`;
  }

  const multiplier = token === 'USDC' ? 1_000_000 : 1_000_000_000;
  const baseUnits = Math.round(amount * multiplier);

  if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
    return `${token} amount is too small or too large.`;
  }

  return null;
}


function soltasticCountDecimals(value: string): number {
  const clean = value.trim();
  if (!clean.includes('.')) return 0;
  return clean.split('.')[1]?.length ?? 0;
}

function soltasticValidateTransferInput(
  receiverAddress: string,
  amountText: string,
  selectedToken: string,
): string | null {
  const address = soltasticNormalizeSolanaAddressInput(receiverAddress);

  if (!address) {
    return 'Receiver address is required.';
  }

  try {
    new PublicKey(address);
  } catch {
    return 'Receiver address is not a valid Solana address.';
  }

  const cleanAmount = String(amountText ?? '').trim();

  if (!cleanAmount) {
    return 'Amount is required.';
  }

  if (!/^\d+(\.\d+)?$/.test(cleanAmount)) {
    return 'Amount must be a positive decimal number.';
  }

  const amount = Number(cleanAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Amount must be greater than 0.';
  }

  const token = selectedToken === 'USDC' ? 'USDC' : 'SOL';
  const decimals = token === 'USDC' ? 6 : 9;

  if (soltasticCountDecimals(cleanAmount) > decimals) {
    return `${token} amount supports maximum ${decimals} decimal places.`;
  }

  const multiplier = token === 'USDC' ? 1_000_000 : 1_000_000_000;
  const baseUnits = Math.round(amount * multiplier);

  if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
    return `${token} amount is too small or too large.`;
  }

  return null;
}


function shortNonceValue(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}


function soltasticNormalizeSolanaAddressInput(value: string): string {
  let text = String(value ?? '').trim();

  // Accept common QR/clipboard formats:
  // solana:<address>
  // solana:<address>?amount=...
  // <address>?amount=...
  if (text.startsWith('solana:')) {
    text = text.slice('solana:'.length);
  }

  const queryIndex = text.indexOf('?');
  if (queryIndex >= 0) {
    text = text.slice(0, queryIndex);
  }

  const slashIndex = text.indexOf('/');
  if (slashIndex >= 0 && !text.includes(' ')) {
    // Keep normal base58 addresses untouched; this only helps accidental URI paths.
    const last = text.split('/').filter(Boolean).pop();
    if (last) text = last;
  }

  return text.trim();
}



function DurableNonceCardInline({
  serverState,
  requesting,
}: {
  serverState: unknown;
  requesting: boolean;
}) {
  const nonceValue = getDurableNonceValue(serverState);
  const nonceStatus = nonceValue ? shortNonceValue(nonceValue) : requesting ? 'REQUEST' : 'EMPTY';

  return (
    <View style={styles.card}>
      <View style={styles.durableCardHeader}>
        <Text style={styles.cardTitle}>Durable Nonce</Text>
        <Text
          selectable={!!nonceValue}
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[
            styles.durableCardStatus,
            nonceValue ? styles.durableCardStatusReady : null,
            requesting && !nonceValue ? styles.durableCardStatusRequest : null,
          ]}
        >
          {nonceStatus}
        </Text>
      </View>
    </View>
  );
}


function countDecimals(value: string): number {
  const clean = String(value ?? '').trim();
  if (!clean.includes('.')) return 0;
  return clean.split('.')[1]?.length ?? 0;
}


function shortUiValue(value: string | null | undefined, left = 4, right = 4): string {
  if (!value) return '';
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function extractTxHashFromMessage(message: string | null | undefined): string | null {
  if (!message) return null;

  const match = String(message).match(/(?:TX HASH|tx_hash|Transaction hash)\s*:?\s*([1-9A-HJ-NP-Za-km-z]{64,110})/);
  return match?.[1] ?? null;
}


const STORAGE_WALLET_SESSION_KEY = 'soltastic.walletSession.v1';
const STORAGE_BLE_DEVICE_KEY = 'soltastic.bleDevice.v1';

type StoredBleDevice = {
  id: string;
  name?: string | null;
  localName?: string | null;
};

async function saveWalletSession(session: WalletSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_WALLET_SESSION_KEY, JSON.stringify(session));
}

async function loadWalletSession(): Promise<WalletSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_WALLET_SESSION_KEY);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as WalletSession;
  if (!parsed?.address || !parsed?.authToken) return null;

  return parsed;
}

async function clearWalletSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_WALLET_SESSION_KEY);
}

async function saveBleDevice(device: StoredBleDevice): Promise<void> {
  if (!device?.id) return;
  await AsyncStorage.setItem(STORAGE_BLE_DEVICE_KEY, JSON.stringify(device));
}

async function loadBleDevice(): Promise<StoredBleDevice | null> {
  const raw = await AsyncStorage.getItem(STORAGE_BLE_DEVICE_KEY);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as StoredBleDevice;
  if (!parsed?.id) return null;

  return parsed;
}

async function clearBleDevice(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_BLE_DEVICE_KEY);
}

export default function App() {
  const meshRef = useRef(new MeshClient());
  const startupRestoreStartedRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [meshConnected, setMeshConnected] = useState(false);
  const [bleDevices, setBleDevices] = useState<BleDeviceInfo[]>([]);
  const [selectedBleDeviceId, setSelectedBleDeviceId] = useState<string | null>(null);
  const [connectedBleName, setConnectedBleName] = useState<string | null>(null);
  const [bleScanning, setBleScanning] = useState(false);
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [selectedToken, setSelectedToken] = useState<TokenSymbol>('SOL');
  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingTxHash, setAwaitingTxHash] = useState(false);
  const awaitingTxHashRef = useRef(false);
  const txFlowFinishedRef = useRef(false);
  const lastSubmitTextRef = useRef<string | null>(null);
  const [showInitAfterSend, setShowInitAfterSend] = useState(false);
  const [status, setStatus] = useState('Connect wallet and Meshtastic node.');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastTxHashCopied, setLastTxHashCopied] = useState(false);
  const [nonceRequesting, setNonceRequesting] = useState(false);
  const [txHashCopied, setTxHashCopied] = useState(false);
  const autoBleScanStartedRef = useRef(false);
  const autoInitRunningRef = useRef(false);
  const forceBleScanStartedRef = useRef(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logScrollRef = useRef<any>(null);

  // Hide Android navigation bar so it does not cover the log.
  useEffect(() => {
    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
  }, []);

  const [qrVisible, setQrVisible] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);

  const addLog = useCallback((text: string, level: LogLevel = 'info') => {
    setLogs((prev) => [
      ...prev.slice(-300),
      { id: `${Date.now()}-${Math.random()}`, time: nowTime(), level, text: typeof text === 'string' ? text : JSON.stringify(text) }
    ]);
  }, []);

  useEffect(() => {
    setTxHashCopied(false);
  }, [status]);

  useEffect(() => {
    awaitingTxHashRef.current = awaitingTxHash;
  }, [awaitingTxHash]);

  const resetTransferPanel = useCallback((message?: string) => {
    setServerState(null);
    setReceiverAddress('');
    setAmount('');
    setSelectedToken('SOL');
    awaitingTxHashRef.current = false;

    setAwaitingTxHash(false);
    setShowInitAfterSend(false);
    if (message) setStatus(message);
  }, []);

  const finishSendFlow = useCallback((message: string) => {
    const finalTxHash = extractTxHashFromMessage(message);
    if (finalTxHash) {
      setLastTxHash(finalTxHash);
      setLastTxHashCopied(false);
    }

    setReceiverAddress('');
    setAmount('');
    setBusy(false);
    awaitingTxHashRef.current = false;
    txFlowFinishedRef.current = true;
    awaitingTxHashRef.current = false;

    setAwaitingTxHash(false);
    setShowInitAfterSend(true);
    setStatus(message);
  }, []);

  const handleMeshMessage = useCallback(
    (packet: Types.PacketMetadata<string>) => {
      const text = String(packet?.data ?? '').trim();
      if (!text) return;

      if (typeof (packet as any).channel === 'number' && (packet as any).channel !== MESH_CHANNEL_SLOT) {
        return;
      }

      addLog(`RX slot ${(packet as any).channel ?? '?'}: ${text}`);

      if (awaitingTxHashRef.current && text.startsWith('ST,')) {
        const lastSubmitText = lastSubmitTextRef.current;

        if (lastSubmitText && text === lastSubmitText) {
          addLog('Ignoring own submit echo while waiting for tx_hash.');
          return;
        }

        if (isSubmitStylePacket(text)) {
          addLog('Ignoring submit-style ST packet while waiting for tx_hash.');
          return;
        }

        const txHash = parseTxHashReply(text);
        if (txHash) {
          const msg = `TX HASH: ${txHash}`;
          addLog(msg, 'ok');
          finishSendFlow(msg);
          return;
        }

        const txParsed = parseServerReply(text);
        if (txParsed?.error) {
          const msg = txErrorText(txParsed.error);
          addLog(msg, 'err');
          finishSendFlow(msg);
          return;
        }

        addLog(`Ignoring non-final ST while waiting for tx_hash: ${text}`);
        return;
      }

      const parsed = parseServerReply(text);
      if (!parsed) return;

      if (parsed.error) {
        const msg = `Server error e=${parsed.error}; SOL=${parsed.solBalanceText}, USDC=${parsed.usdcBalanceText}`;
        addLog(msg, 'err');
        setStatus(msg);
        return;
      }

      try {
        if (!parsed.nonceAccountAddress || !parsed.nonceValue || !parsed.serverFeeAddress) {
          throw new Error('Server reply has no nonce or fee address');
        }

        parsePublicKey(parsed.nonceAccountAddress, 'nonce account');
        parsePublicKey(parsed.serverFeeAddress, 'server fee address');

        const nextState: ServerState = {
          solBalanceText: parsed.solBalanceText,
          usdcBalanceText: parsed.usdcBalanceText,
          solLamports: parseDecimalToUnits(parsed.solBalanceText, 9, { allowZero: true }),
          usdcUnits: parseDecimalToUnits(parsed.usdcBalanceText, 6, { allowZero: true }),
          nonceAccountAddress: parsed.nonceAccountAddress,
          nonceValue: parsed.nonceValue,
          serverFeeAddress: parsed.serverFeeAddress,
          serverFrom: getPacketFrom(packet),
          serverPacketId: getPacketId(packet)
        };

        setShowInitAfterSend(false);
        awaitingTxHashRef.current = false;

        setAwaitingTxHash(false);
        setShowInitAfterSend(false);
        txFlowFinishedRef.current = false;
        lastSubmitTextRef.current = null;
        awaitingTxHashRef.current = false;
        setNonceRequesting(false);
        setServerState(nextState);
        setStatus('Balances and durable nonce received.');
        addLog(
          `Reply target: from=${nextState.serverFrom ?? '?'}, id=${nextState.serverPacketId ?? '?'}`
        );
        addLog('Balance and durable nonce received', 'ok');
      } catch (e) {
        const msg = errorToText(e);
        addLog(msg, 'err');
        setStatus(msg);
      }
    },
    [addLog, finishSendFlow]
  );


  const openQrScanner = useCallback(async () => {
    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();

      if (!permission.granted) {
        const msg = 'Camera permission is required to scan a receiver QR code.';
        addLog(msg, 'err');
        Alert.alert('Camera permission', msg);
        return;
      }

      setQrLocked(false);
      setQrVisible(true);
    } catch (e) {
      const msg = errorToText(e);
      addLog(`QR scanner error: ${msg}`, 'err');
      Alert.alert('QR scanner error', msg);
    }
  }, [addLog, cameraPermission, requestCameraPermission]);

  useEffect(() => {
    if (autoBleScanStartedRef.current) return;

    autoBleScanStartedRef.current = true;

    const timer = setTimeout(() => {
      addLog('Auto BLE scan starting...');
      Promise.resolve(openQrScanner()).catch((e) => {
        const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
        addLog(`Auto BLE scan failed: ${msg}`, 'err');
      });
    }, 700);

  
  return () => clearTimeout(timer);
  }, [addLog, openQrScanner]);


  const handleQrScanned = useCallback((result: BarcodeScanningResult) => {
    if (qrLocked) return;

    const data = String(result.data ?? '').trim();
    const address = extractSolanaAddressFromQr(data);

    if (!address) {
      setQrLocked(true);
      addLog('QR scanned, but no valid Solana address was found.', 'err');
      Alert.alert('QR scan', 'No valid Solana address was found in this QR code.');
      setTimeout(() => setQrLocked(false), 900);
      return;
    }

    setQrLocked(true);
    setReceiverAddress(address);
    setQrVisible(false);
    addLog(`QR receiver: ${shortAddress(address)}`, 'ok');
  }, [addLog, qrLocked]);

  const canInit = Boolean(wallet?.address && meshConnected && (!serverState || showInitAfterSend));
  const canSend = Boolean(wallet?.address && meshConnected && serverState && receiverAddress && amount && !awaitingTxHash);



  const connectWalletPress = useCallback(async () => {
    setBusy(true);
    try {
      const session = await connectWallet();
      setWallet(session);
      await saveWalletSession(session);
      addLog(`Wallet connected: ${session.address}`, 'ok');
      setStatus('Wallet connected.');
    } catch (e) {
      const msg = errorToText(e);
      addLog(`Wallet error: ${msg}`, 'err');
      Alert.alert('Wallet error', msg);
    } finally {
      setBusy(false);
    }
  }, [addLog]);

  const disconnectWalletPress = useCallback(async () => {
    const authToken = wallet?.authToken;
    setWallet(null);
    await clearWalletSession();
    resetTransferPanel('Wallet disconnected.');
    if (authToken) await disconnectWallet(authToken);
    addLog('Wallet disconnected');
  }, [addLog, resetTransferPanel, wallet?.authToken]);

  const scanMeshPress = useCallback(async () => {
    setBleScanning(true);
    try {
      const devices = await meshRef.current.scan(addLog);
      setBleDevices(devices);
      setSelectedBleDeviceId(devices[0]?.id ?? null);

      if (devices.length === 0) {
        Alert.alert('BLE scan', 'No Meshtastic BLE nodes found. Check that the node is powered on and Bluetooth is enabled.');
      }
    } catch (e) {
      const msg = errorToText(e);
      addLog(`BLE scan error: ${msg}`, 'err');
      Alert.alert('BLE scan error', msg);
    } finally {
      setBleScanning(false);
    }
  }, [addLog]);


  const connectMeshPress = useCallback(async () => {
    if (!selectedBleDeviceId) {
      Alert.alert('BLE connection', 'First scan and select a Meshtastic node.');
      return;
    }

    setBusy(true);
    try {
      const selected = bleDevices.find((item) => item.id === selectedBleDeviceId);
      await meshRef.current.connect(selectedBleDeviceId, addLog, handleMeshMessage);
      setMeshConnected(true);
      await saveBleDevice({
        id: selectedBleDeviceId,
        name: selected?.name ?? null,
        localName: selected?.localName ?? null,
      });
      setConnectedBleName(selected?.name ?? selected?.localName ?? selectedBleDeviceId);
      addLog(`Mesh connected: ${selected?.name ?? selected?.localName ?? selectedBleDeviceId}`, 'ok');
      setStatus('Meshtastic node connected.');
    } catch (e) {
      const msg = errorToText(e);
      addLog(`BLE connection error: ${msg}`, 'err');
      Alert.alert('BLE connection error', msg);
    } finally {
      setBusy(false);
    }
  }, [addLog, bleDevices, handleMeshMessage, selectedBleDeviceId]);


  const connectBleDevicePress = useCallback(async (item: BleDeviceInfo) => {
    if (busy || bleScanning || meshConnected) return;

    setSelectedBleDeviceId(item.id);
    setBusy(true);

    try {
      const label = item.name ?? item.localName ?? item.id;
      addLog(`Selected BLE: ${label}`);
      addLog(`Connecting BLE: ${label}`);
      await meshRef.current.connect(item.id, addLog, handleMeshMessage);
      setMeshConnected(true);
      await saveBleDevice({
        id: item.id,
        name: item.name ?? null,
        localName: item.localName ?? null,
      });
      setConnectedBleName(label);
      addLog(`Mesh connected: ${label}`, 'ok');
      setStatus('Meshtastic node connected.');
    } catch (e) {
      const msg = errorToText(e);
      addLog(`BLE connection error: ${msg}`, 'err');
      Alert.alert('BLE connection error', msg);
    } finally {
      setBusy(false);
    }
  }, [addLog, bleScanning, busy, handleMeshMessage, meshConnected]);

  // Restore saved wallet session and BLE device after startup.
  useEffect(() => {
    if (startupRestoreStartedRef.current) return;

    startupRestoreStartedRef.current = true;

    let cancelled = false;

    const restore = async () => {
      let restoredWallet: WalletSession | null = null;

      try {
        const savedWallet = await loadWalletSession();

        if (savedWallet?.authToken) {
          addLog(`Restoring wallet: ${shortAddress(savedWallet.address)}`);
          restoredWallet = await reconnectWallet(savedWallet);

          if (cancelled) return;

          setWallet(restoredWallet);
          await saveWalletSession(restoredWallet);
          addLog(`Wallet restored: ${restoredWallet.address}`, 'ok');
          setStatus('Wallet restored.');
        }
      } catch (e) {
        await clearWalletSession();

        if (!cancelled) {
          const msg = errorToText(e);
          addLog(`Wallet restore failed: ${msg}`, 'err');
          setStatus('Connect wallet.');
        }
      }

      try {
        const savedBle = await loadBleDevice();

        if (!savedBle?.id) {
          addLog('No saved BLE node. Auto scan starting...');
          const devices = await meshRef.current.scan(addLog);

          if (cancelled) return;

          setBleDevices(devices);
          setSelectedBleDeviceId(devices[0]?.id ?? null);
          return;
        }

        const label = savedBle.name ?? savedBle.localName ?? savedBle.id;
        addLog(`Restoring BLE: ${label}`);
        setSelectedBleDeviceId(savedBle.id);

        try {
          await meshRef.current.connect(savedBle.id, addLog, handleMeshMessage);
        } catch (directError) {
          addLog('Direct BLE reconnect failed. Scanning...');

          const devices = await meshRef.current.scan(addLog);

          if (cancelled) return;

          setBleDevices(devices);

          const matched =
            devices.find((item) => item.id === savedBle.id) ??
            devices.find((item) => {
              const savedName = savedBle.name ?? savedBle.localName;
              const itemName = item.name ?? item.localName;
              return !!savedName && !!itemName && itemName === savedName;
            });

          if (!matched) {
            throw directError;
          }

          setSelectedBleDeviceId(matched.id);
          await meshRef.current.connect(matched.id, addLog, handleMeshMessage);
          await saveBleDevice({
            id: matched.id,
            name: matched.name ?? null,
            localName: matched.localName ?? null,
          });
        }

        if (cancelled) return;

        setMeshConnected(true);
        setConnectedBleName(label);
        addLog(`Mesh restored: ${label}`, 'ok');
        setStatus(restoredWallet ? 'Wallet and Meshtastic restored.' : 'Meshtastic restored.');
      } catch (e) {
        if (!cancelled) {
          const msg = errorToText(e);
          addLog(`BLE restore failed: ${msg}`, 'err');
          addLog('BLE auto scan starting...');
          try {
            const devices = await meshRef.current.scan(addLog);

            if (cancelled) return;

            setBleDevices(devices);
            setSelectedBleDeviceId(devices[0]?.id ?? null);
          } catch (scanError) {
            if (!cancelled) {
              addLog(`BLE auto scan failed: ${errorToText(scanError)}`, 'err');
            }
          }
        }
      }
    };

    const timer = setTimeout(() => {
      void restore();
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addLog, handleMeshMessage]);

  const disconnectMeshPress = useCallback(async () => {
    setBusy(true);
    try {
      await meshRef.current.disconnect();
      await clearBleDevice();
      setMeshConnected(false);
      setConnectedBleName(null);
      setSelectedBleDeviceId(null);
      resetTransferPanel('Meshtastic disconnected.');
      addLog('Mesh disconnected');
    } finally {
      setBusy(false);
    }
  }, [addLog, resetTransferPanel]);


  const copyTxHashPress = useCallback(async () => {
    const txHash = txHashFromStatus(status);

    if (!txHash) {
      addLog('No TX HASH to copy.');
      return;
    }

    try {
      await Clipboard.setStringAsync(txHash);
      setTxHashCopied(true);
      addLog('TX HASH copied.', 'ok');
    } catch (e) {
      const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
      addLog(`Copy failed: ${msg}`, 'err');
    }
  }, [addLog, status]);


  const pasteReceiverPress = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();

      if (!text || !text.trim()) {
        addLog('Clipboard is empty.', 'err');
        return;
      }

      setReceiverAddress(text.trim());
      addLog('Receiver address pasted.', 'ok');
    } catch (e) {
      const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
      addLog(`Paste failed: ${msg}`, 'err');
    }
  }, [addLog]);

  const sendInitPress = useCallback(async () => {
    if (!wallet?.address) return;

    setNonceRequesting(true);
    lastSubmitTextRef.current = null;
    txFlowFinishedRef.current = false;
    awaitingTxHashRef.current = false;
    setShowInitAfterSend(false);
    awaitingTxHashRef.current = false;

    setAwaitingTxHash(false);
    setBusy(true);
    try {
      const text = `ST,init,${wallet.address}`;
      addLog(`TX init: ${text}`);
      setStatus('Init is being sent. Waiting for server response in slot 7...');
      await meshRef.current.sendText(text);
      addLog(`Sent: ${text}`, 'ok');
      setStatus('Init sent. Waiting for server response in slot 7...');
    } catch (e) {
      setNonceRequesting(false);
      const msg = errorToText(e);
      addLog(`Init send error: ${msg}`, 'err');
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  }, [addLog, wallet?.address]);

  // Auto Init when wallet and BLE are both connected.
  // Runs first when serverState is empty, then again after each final tx result.
  useEffect(() => {
    if (!wallet?.address) return;
    if (!meshConnected) return;
    if (autoInitRunningRef.current) return;
    if (awaitingTxHash) return;
    if (busy && !showInitAfterSend) return;
    if (serverState && !showInitAfterSend) return;

    autoInitRunningRef.current = true;

    const timer = setTimeout(() => {
      addLog(serverState ? 'Auto Init after transaction...' : 'Auto Init after wallet + BLE connect...');
      Promise.resolve(sendInitPress())
        .catch((e) => {
          const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
          addLog(`Auto Init failed: ${msg}`, 'err');
        })
        .finally(() => {
          autoInitRunningRef.current = false;
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [
    wallet?.address,
    meshConnected,
    serverState,
    showInitAfterSend,
    awaitingTxHash,
    busy,
    addLog,
    sendInitPress,
  ]);




  const copyLastTxHashPress = useCallback(async () => {
    if (!lastTxHash) return;

    try {
      await Clipboard.setStringAsync(lastTxHash);
      setLastTxHashCopied(true);
      addLog('TX HASH copied.', 'ok');
    } catch (e) {
      const msg = typeof errorToText === 'function' ? errorToText(e) : String(e);
      addLog(`Copy TX HASH failed: ${msg}`, 'err');
    }
  }, [addLog, lastTxHash]);

  const sendTransferPress = useCallback(async () => {
    setLastTxHash(null);
    setLastTxHashCopied(false);


    const normalizedReceiverAddress = soltasticNormalizeSolanaAddressInput(receiverAddress);

    const transferValidationError = soltasticValidateTransferInput(
      normalizedReceiverAddress,
      amount,
      selectedToken,
    );

    if (transferValidationError) {
      setStatus(transferValidationError);
      addLog(transferValidationError, 'err');
      return;
    }

    if (!wallet?.address || !serverState) return;

    setShowInitAfterSend(false);
    setBusy(true);
    try {
      const prepared = prepareSoltasticTransfer({
        walletAddress: wallet.address,
        receiverAddress: normalizedReceiverAddress,
        amount,
        token: selectedToken,
        serverState
      });

      const tx = buildSoltasticTransaction({
        token: selectedToken,
        serverState,
        prepared
      });

      setStatus('Open wallet and sign the transaction.');
      addLog('Opening wallet for signing...');

      const signed = await signTransactionWithWallet(tx, wallet);
      setWallet(signed.session);
      await saveWalletSession(signed.session);

      const signature = extractSenderSignature(signed.signedTransaction, prepared.senderPk);
      const receiver = prepared.receiverPk.toBase58();
      const text = `ST,${receiver},${selectedToken},${prepared.amountText},${signature}`;

      awaitingTxHashRef.current = true;
      lastSubmitTextRef.current = text;
      txFlowFinishedRef.current = false;
      awaitingTxHashRef.current = true;
      setShowInitAfterSend(false);
      setAwaitingTxHash(true);
      setStatus('Signature is being sent to server. Waiting for confirmed tx_hash...');
      addLog(`TX reply: ${text}`);
      await meshRef.current.sendText(text, serverState.serverPacketId ?? undefined);
      addLog('Signature sent. Waiting for confirmed tx_hash from server...', 'ok');
    } catch (e) {
      const msg = errorToText(e);

      if (txFlowFinishedRef.current) {
        addLog(`Mesh send status after tx result ignored: ${msg}`);
      } else {
        addLog(`Send error: ${msg}`, 'err');
        finishSendFlow(`Send error: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }, [addLog, amount, receiverAddress, selectedToken, serverState, wallet]);

  const topContent = (
      <>

        <View style={styles.card}>
          {wallet ? (
            <View style={styles.inlineStatusRow}>
              <Text style={styles.valueCompact} numberOfLines={1}>{shortAddress(wallet.address)}</Text>
              <Pressable
                onPress={disconnectWalletPress}
                disabled={busy}
                style={({ pressed }) => [
                  styles.disconnectPill,
                  busy ? styles.buttonDisabled : null,
                  pressed && !busy ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.disconnectPillText}>Disconnect</Text>
              </Pressable>
            </View>
          ) : (
            <Button title="Connect wallet" onPress={connectWalletPress} disabled={busy} />
          )}
        </View>

        <View style={styles.card}>
          {meshConnected ? (
            <View style={styles.inlineStatusRow}>
              <Text style={styles.valueCompact} numberOfLines={1}>{connectedBleName ?? 'Meshtastic node'}</Text>
              <Pressable
                onPress={disconnectMeshPress}
                disabled={busy}
                style={({ pressed }) => [
                  styles.disconnectPill,
                  busy ? styles.buttonDisabled : null,
                  pressed && !busy ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.disconnectPillText}>Disconnect</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Button
                title={bleScanning ? 'Scanning BLE...' : 'Scan BLE'}
                onPress={scanMeshPress}
                disabled={busy || bleScanning}
              />

              {bleDevices.length > 0 ? (
                <View style={styles.deviceListCompact}>
                  {bleDevices.map((item) => {
                    const selected = item.id === selectedBleDeviceId;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          void connectBleDevicePress(item);
                        }}
                        disabled={busy || bleScanning}
                        style={({ pressed }) => [
                          styles.deviceItemCompact,
                          selected ? styles.deviceItemSelected : null,
                          pressed && !busy && !bleScanning ? styles.deviceItemPressed : null,
                        ]}
                      >
                        <Text style={styles.deviceName} numberOfLines={1}>{item.name ?? item.localName ?? 'Unnamed Meshtastic node'}</Text>
                        <Text style={styles.deviceMeta} numberOfLines={1}>
                          {item.id}{item.rssi != null ? ` · RSSI ${item.rssi}` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.muted}>Scan and tap a Meshtastic node to connect.</Text>
              )}
            </>
          )}
        </View>
        {wallet?.address && meshConnected ? (
          <DurableNonceCardInline serverState={serverState} requesting={nonceRequesting} />
        ) : null}
        {serverState ? (
        <View style={styles.card}>
            <>

              <View style={styles.tokenColumn}>
                <Pressable
                  onPress={() => setSelectedToken('SOL')}
                  style={({ pressed }) => [
                    styles.tokenFullButton,
                    selectedToken === 'SOL' ? styles.tokenFullButtonSelected : null,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.tokenFullName}>SOL</Text>
                  <Text style={styles.tokenFullBalance}>{serverState.solBalanceText}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setSelectedToken('USDC')}
                  style={({ pressed }) => [
                    styles.tokenFullButton,
                    selectedToken === 'USDC' ? styles.tokenFullButtonSelected : null,
                    pressed ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.tokenFullName}>USDC</Text>
                  <Text style={styles.tokenFullBalance}>{serverState.usdcBalanceText}</Text>
                </Pressable>

                <Text style={styles.muted}>Service fee: {SERVICE_FEE_SOL} SOL</Text>
              </View>

              <View style={styles.addressRow}>
                <TextInput
                  value={receiverAddress}
                  onChangeText={setReceiverAddress}
                  placeholder="Receiver Solana address"
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.addressInput]}
                />
                <Pressable
                  onPress={openQrScanner}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.qrButton,
                    busy ? styles.buttonDisabled : null,
                    pressed && !busy ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.qrButtonText}>Scan QR</Text>
                </Pressable>
              </View>

              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={selectedToken === 'SOL' ? '0.01' : '1.5'}
                placeholderTextColor="#6b7280"
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <Button title="Send" onPress={sendTransferPress} disabled={!canSend} />
              {lastTxHash ? (
                <View style={styles.txHashRow}>
                  <View style={styles.txHashTextBox}>
                    <Text style={styles.txHashLabel}>TX HASH</Text>
                    <Text
                      selectable
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={styles.txHashValue}
                    >
                      {shortUiValue(lastTxHash, 6, 6)}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.txHashCopyButton}
                    activeOpacity={0.8}
                    onPress={copyLastTxHashPress}
                    accessibilityLabel="Copy TX hash"
                  >
                    <Ionicons
                      name={lastTxHashCopied ? 'checkmark-outline' : 'copy-outline'}
                      size={21}
                      color="#071019"
                    />
                  </TouchableOpacity>
                </View>
              ) : null}


            </>
        </View>
        ) : null}
      </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safe}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Soltastic</Text>
          {busy ? <ActivityIndicator /> : null}
        </View>


        <Modal visible={qrVisible} animationType="slide" onRequestClose={() => setQrVisible(false)}>
          <SafeAreaView style={styles.cameraModal}>
            <View style={styles.cameraHeader}>
              <Text style={styles.cameraTitle}>Scan receiver QR</Text>
              <Pressable
                onPress={() => setQrVisible(false)}
                style={({ pressed }) => [styles.disconnectPill, pressed ? styles.buttonPressed : null]}
              >
                <Text style={styles.disconnectPillText}>Close</Text>
              </Pressable>
            </View>

            <CameraView
              style={styles.cameraView}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={qrLocked ? undefined : handleQrScanned}
            />

            <Text style={styles.cameraHint}>Point the camera at a Solana address QR code.</Text>
          </SafeAreaView>
        </Modal>

        
        <View style={styles.container}>
          <ScrollView style={styles.topPane} contentContainerStyle={styles.topContent}>
            {topContent}
          </ScrollView>

          <StatusPanelInline status={status || ''} />
          <View style={styles.logPane}>
            <View style={styles.logHeader}>
              <Text style={styles.logTitle}>Log</Text>
              <Pressable onPress={() => setLogs([])}>
                <Text style={styles.clear}>clear</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}
            ref={logScrollRef}
            onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => logScrollRef.current?.scrollToEnd({ animated: false })}>
              {logs.length === 0 ? (
                <Text style={styles.muted}>No logs yet.</Text>
              ) : (
                logs.map((line) => (
                  <Text key={line.id} style={[styles.logLine, line.level === 'ok' ? styles.logOk : line.level === 'err' ? styles.logErr : styles.logInfo]}>
                    {line.time} {line.text}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#070b12'
  },
  header: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#172033'
  },
  title: {
    color: '#e5e7eb',
    fontSize: 22,
    fontWeight: '800'
  },
  container: {
    flex: 1
  },
  topPane: {
    height: '75%',
    flexGrow: 0,
    flexShrink: 0
  },
  logPane: {
    height: '25%',
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 1,
    borderColor: '#172033',
    backgroundColor: '#05070d'
  },
  card: {
    minHeight: 64,
    backgroundColor: '#0e1625',
    borderColor: '#1f2a44',
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 7
  },
  cardTitle: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  value: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '700'
  },
  status: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  button: {
    width: '100%',
minHeight: 54,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  buttonPrimary: {
    backgroundColor: '#14f195'
  },
  buttonSecondary: {
    backgroundColor: '#4f46e5'
  },
  buttonDanger: {
    backgroundColor: '#ef4444'
  },
  buttonDisabled: {
    opacity: 0.35
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }]
  },
  buttonText: {
    color: '#03120b',
    fontWeight: '800',
    fontSize: 14
  },
  balanceBox: {
    backgroundColor: '#07111f',
    borderRadius: 12,
    padding: 10,
    gap: 4
  },
  balance: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '700'
  },
  muted: {
    color: '#6b7280',
    fontSize: 12
  },
  tokenRow: {
    flexDirection: 'row',
    gap: 8
  },
  tokenButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243049',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tokenSelected: {
    borderColor: '#14f195',
    backgroundColor: '#09291d'
  },
  tokenText: {
    color: '#e5e7eb',
    fontWeight: '800'
  },
  tokenColumn: {
    gap: 8
  },
  tokenFullButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243049',
    backgroundColor: '#07111f',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  tokenFullButtonSelected: {
    borderColor: '#14f195',
    backgroundColor: '#0b3b29'
  },
  tokenFullName: {
    color: '#e5e7eb',
    fontWeight: '900',
    fontSize: 15
  },
  tokenFullBalance: {
    color: '#14f195',
    fontWeight: '800',
    fontSize: 14
  },
  addressRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  addressInput: {
    flex: 1
  },
  qrButton: {
    minHeight: 44,
    minWidth: 88,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#14f195'
  },
  qrButtonText: {
    color: '#03120b',
    fontWeight: '900',
    fontSize: 13
  },
  cameraModal: {
    flex: 1,
    backgroundColor: '#05070d'
  },
  cameraHeader: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#172033'
  },
  cameraTitle: {
    color: '#e5e7eb',
    fontWeight: '900',
    fontSize: 17
  },
  cameraView: {
    flex: 1
  },
  cameraHint: {
    color: '#cbd5e1',
    fontSize: 13,
    textAlign: 'center',
    padding: 12
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#060d18',
    borderWidth: 1,
    borderColor: '#243049',
    color: '#e5e7eb',
    paddingHorizontal: 12,
    fontSize: 15
  },
  deviceList: {
    gap: 8
  },
  deviceItem: {
    borderWidth: 1,
    borderColor: '#243049',
    backgroundColor: '#060d18',
    borderRadius: 12,
    padding: 10,
    gap: 3
  },
  deviceItemSelected: {
    borderColor: '#14f195',
    backgroundColor: '#0b3b29'
  },
  deviceName: {
    color: '#e5e7eb',
    fontWeight: '800',
    fontSize: 14
  },
  deviceMeta: {
    color: '#9ca3af',
    fontSize: 11
  },

  inlineStatusRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  valueCompact: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '800'
  },
  disconnectPill: {
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  disconnectPillText: {
    color: '#fff7ed',
    fontWeight: '900',
    fontSize: 13
  },
  deviceListCompact: {
    gap: 6,
    maxHeight: 150
  },
  deviceItemCompact: {
    borderWidth: 1,
    borderColor: '#243049',
    backgroundColor: '#060d18',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
    gap: 2
  },
  deviceItemPressed: {
    transform: [{ scale: 0.99 }]
  },
  logHeader: {
    height: 30,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#172033'
  },
  logTitle: {
    color: '#e5e7eb',
    fontWeight: '800'
  },
  clear: {
    color: '#14f195',
    fontWeight: '700'
  },
  logScroll: {
    flex: 1
  },
  logContent: {
    padding: 8,
    gap: 3
  },
  logLine: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({ android: 'monospace', default: undefined })
  },
  logInfo: {
    color: '#cbd5e1'
  },
  logOk: {
    color: '#14f195'
  },
  logErr: {
    color: '#f87171'
  },
  statusPane: {
    flex: 0.55,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#24315f',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#071019',
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusScroll: {
    flex: 1,
  },
  statusScrollContent: {
    paddingBottom: 4,
  },
  statusText: {
    color: '#dce8ff',
    fontSize: 13,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  statusTextOk: {
    color: '#20f58a',
  },
  copyButton: {
    backgroundColor: '#14f195',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
  },
  copyButtonText: {
    color: '#071019',
    fontWeight: '800',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  statusInline: {
    minHeight: 86,
    maxHeight: 118,
    marginHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#14f195',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#071019',
  },
  statusInlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusInlineTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  statusInlineText: {
    color: '#dce8ff',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  statusInlineTextOk: {
    color: '#20f58a',
  },
  statusCopyButton: {
    backgroundColor: '#14f195',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusCopyButtonText: {
    color: '#071019',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  durableNonceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#24315f',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8,
    backgroundColor: '#081827',
  },
  durableNonceLabel: {
    color: '#dce8ff',
    fontSize: 13,
    fontWeight: '700',
  },
  durableNonceValue: {
    color: '#94a3b8',
    fontSize: 13,
    fontFamily: 'monospace',
    maxWidth: '62%',
    textAlign: 'right',
  },
  durableNonceReady: {
    color: '#20f58a',
  },
  squareActionButton: {
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14f195',
    marginLeft: 8,
  },
  squareActionButtonText: {
    color: '#071019',
    fontSize: 12,
    fontWeight: '800',
  },
  durableCardHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  durableCardStatus: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
    fontFamily: 'monospace',
    maxWidth: '58%',
    textAlign: 'right',
    textAlignVertical: 'center',
  },
  durableCardStatusReady: {
    color: '#20f58a',
    textTransform: 'none',
  },
  durableCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  durableCardValueLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  durableCardValue: {
    color: '#94a3b8',
    fontSize: 15,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  durableCardValueReady: {
    color: '#dce8ff',
  },
  durableCardStatusRequest: {
    color: '#fbbf24',
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  topContent: {
    flex: 3,
  },
  squareIconButton: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14f195',
    marginLeft: 8,
  },
  txHashRow: {
    marginTop: 10,
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#14f195',
    borderRadius: 14,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#071827',
  },
  txHashTextBox: {
    flex: 1,
    paddingRight: 10,
  },
  txHashLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
  },
  txHashValue: {
    color: '#20f58a',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  txHashCopyButton: {
    width: 54,
    height: 54,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14f195',
  },
});

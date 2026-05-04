import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

export function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(String(value).trim());
  } catch {
    throw new Error(`${label}: invalid Solana address`);
  }
}

export function walletAccountToBase58(account: unknown): string {
  const a = account as any;

  if (a?.publicKey?.toBase58) {
    return a.publicKey.toBase58();
  }

  if (a?.publicKey instanceof Uint8Array) {
    return bs58.encode(a.publicKey);
  }

  if (typeof a?.address === 'string') {
    try {
      const raw = Buffer.from(a.address, 'base64');
      if (raw.length === 32) {
        return bs58.encode(raw);
      }
    } catch {
      // Some wallet wrappers already return base58 here.
    }
    return a.address;
  }

  throw new Error('Wallet did not return an account address');
}

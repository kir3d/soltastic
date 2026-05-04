import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync
} from '@solana/spl-token';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  SERVICE_FEE_LAMPORTS,
  TX_FEE_RESERVE_LAMPORTS,
  USDC_MINT
} from '../constants';
import type { ServerState, TokenSymbol } from '../types';
import { normalizeDecimalInput, parseDecimalToUnits } from '../utils/decimal';
import { parsePublicKey } from '../utils/address';

export type PreparedTransfer = {
  senderPk: PublicKey;
  receiverPk: PublicKey;
  noncePk: PublicKey;
  serverFeePubkey: PublicKey;
  amountText: string;
  amountUnits: bigint;
};

export function validateTransferInput(params: {
  walletAddress: string;
  receiverAddress: string;
  amount: string;
  token: TokenSymbol;
  serverState: ServerState;
}): PreparedTransfer {
  const { walletAddress, receiverAddress, amount, token, serverState } = params;

  const senderPk = parsePublicKey(walletAddress, 'sender');
  const receiverPk = parsePublicKey(receiverAddress, 'receiver');
  const noncePk = parsePublicKey(serverState.nonceAccountAddress, 'nonce account');
  const serverFeePubkey = parsePublicKey(serverState.serverFeeAddress, 'server fee address');
  const amountText = normalizeDecimalInput(amount);
  const decimals = token === 'SOL' ? 9 : 6;
  const amountUnits = parseDecimalToUnits(amountText, decimals);

  if (token === 'SOL') {
    const required = amountUnits + SERVICE_FEE_LAMPORTS + TX_FEE_RESERVE_LAMPORTS;
    if (required > serverState.solLamports) {
      throw new Error('Insufficient SOL: amount + service fee + tx fee reserve exceeds balance');
    }
  }

  if (token === 'USDC') {
    if (amountUnits > serverState.usdcUnits) {
      throw new Error('Insufficient USDC');
    }
    if (SERVICE_FEE_LAMPORTS + TX_FEE_RESERVE_LAMPORTS > serverState.solLamports) {
      throw new Error('Insufficient SOL to pay service fee');
    }
  }

  return { senderPk, receiverPk, noncePk, serverFeePubkey, amountText, amountUnits };
}

function createComputeUnitPriceInstruction(microLamports: bigint): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(microLamports, 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data });
}

function createComputeUnitLimitInstruction(units: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data[0] = 2;
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data });
}

export function buildSoltasticTransaction(params: {
  token: TokenSymbol;
  serverState: ServerState;
  prepared: PreparedTransfer;
}): Transaction {
  const { token, serverState, prepared } = params;
  const { senderPk, receiverPk, noncePk, serverFeePubkey, amountUnits } = prepared;

  const tx = new Transaction({
    feePayer: senderPk,
    recentBlockhash: serverState.nonceValue
  });

  // Durable nonce requires nonceAdvance as instruction #1.
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk
    })
  );

  tx.add(createComputeUnitPriceInstruction(COMPUTE_UNIT_PRICE_MICRO_LAMPORTS));
  tx.add(createComputeUnitLimitInstruction(COMPUTE_UNIT_LIMIT));

  if (token === 'SOL') {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: senderPk,
        toPubkey: receiverPk,
        lamports: amountUnits
      })
    );
  } else {
    const mintPk = new PublicKey(USDC_MINT);
    const senderAta = getAssociatedTokenAddressSync(mintPk, senderPk, true, TOKEN_PROGRAM_ID);
    const receiverAta = getAssociatedTokenAddressSync(mintPk, receiverPk, true, TOKEN_PROGRAM_ID);

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
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: senderPk,
      toPubkey: serverFeePubkey,
      lamports: SERVICE_FEE_LAMPORTS
    })
  );

  tx.add(
    SystemProgram.nonceAuthorize({
      noncePubkey: noncePk,
      authorizedPubkey: senderPk,
      newAuthorizedPubkey: serverFeePubkey
    })
  );

  return tx;
}

export function extractSenderSignature(tx: Transaction, sender: PublicKey): string {
  const sigEntry = tx.signatures.find((entry) => entry.publicKey.equals(sender));
  if (!sigEntry?.signature) {
    throw new Error('Wallet did not return the sender signature');
  }
  return bs58.encode(sigEntry.signature);
}

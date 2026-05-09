import { Transaction } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import type { Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { APP_IDENTITY, CHAIN } from '../constants';
import { walletAccountToBase58 } from '../utils/address';

export type WalletSession = {
  address: string;
  authToken: string;
};

function buildAuthorizeParams(authToken?: string) {
  return {
    identity: APP_IDENTITY,
    chain: CHAIN,
    features: ['solana:signTransactions'],
    ...(authToken ? { auth_token: authToken } : {})
  } as any;
}

async function authorizeWallet(
  wallet: Web3MobileWallet,
  authToken?: string
): Promise<WalletSession> {
  const result = await wallet.authorize(buildAuthorizeParams(authToken));

  const account = result.accounts?.[0];
  if (!account) throw new Error('Wallet did not return an account');

  return {
    address: walletAccountToBase58(account),
    authToken: result.auth_token
  };
}

export async function connectWallet(): Promise<WalletSession> {
  return await transact(async (wallet) => authorizeWallet(wallet));
}

export async function reconnectWallet(savedSession: WalletSession): Promise<WalletSession> {
  if (!savedSession?.authToken) {
    throw new Error('No saved wallet auth token');
  }

  return await transact(async (wallet) =>
    authorizeWallet(wallet, savedSession.authToken)
  );
}

export async function disconnectWallet(authToken: string): Promise<void> {
  await transact(async (wallet) => {
    await wallet.deauthorize({ auth_token: authToken });
  }).catch(() => undefined);
}

export async function signTransactionWithWallet(
  transaction: Transaction,
  currentSession: WalletSession | null
): Promise<{ signedTransaction: Transaction; session: WalletSession }> {
  return await transact(async (wallet) => {
    let session = currentSession;

    if (session?.authToken) {
      try {
        session = await authorizeWallet(wallet, session.authToken);
      } catch {
        session = null;
      }
    }

    if (!session) {
      session = await authorizeWallet(wallet);
    }

    const [signed] = await wallet.signTransactions({
      transactions: [transaction]
    });

    return {
      signedTransaction: signed as Transaction,
      session
    };
  });
}

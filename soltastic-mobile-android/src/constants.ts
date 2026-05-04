import { PublicKey } from '@solana/web3.js';

export const CHAIN = 'solana:devnet';
export const RPC_ENDPOINT = 'https://api.devnet.solana.com';

export const APP_IDENTITY = {
  name: 'Soltastic',
  uri: 'https://github.com/kir3d/soltastic',
  icon: 'favicon.png'
};

export const MESH_CHANNEL_SLOT = 7;
export const MESH_BROADCAST_DESTINATION = 'broadcast' as const;

export const SERVICE_FEE_SOL = '0.002';
export const SERVICE_FEE_LAMPORTS = 2_000_000n;
export const TX_FEE_RESERVE_LAMPORTS = 10_000n;

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111'
);
export const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 100_000n;
export const COMPUTE_UNIT_LIMIT = 800_000;

// Devnet USDC mint. Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGkZwyTDt1v
export const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export type TokenSymbol = 'SOL' | 'USDC';

export type ServerState = {
  solBalanceText: string;
  usdcBalanceText: string;
  solLamports: bigint;
  usdcUnits: bigint;
  nonceAccountAddress: string;
  nonceValue: string;
  serverFeeAddress: string;
  serverFrom?: number | null;
  serverPacketId?: number | null;
};

export type ParsedServerReply = {
  error?: string;
  solBalanceText: string;
  usdcBalanceText: string;
  nonceAccountAddress?: string;
  nonceValue?: string;
  serverFeeAddress?: string;
};

export type LogLevel = 'info' | 'ok' | 'err';
export type LogLine = {
  id: string;
  time: string;
  level: LogLevel;
  text: string;
};

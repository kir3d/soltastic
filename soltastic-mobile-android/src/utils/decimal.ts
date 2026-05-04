export function normalizeDecimalInput(value: string): string {
  return String(value).trim().replace(',', '.');
}

export function parseDecimalToUnits(
  value: string,
  decimals: number,
  options: { allowZero?: boolean } = {}
): bigint {
  const { allowZero = false } = options;
  const s = normalizeDecimalInput(value);

  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    throw new Error('Invalid amount format');
  }

  const [whole, fractionRaw = ''] = s.split('.');
  if (fractionRaw.length > decimals) {
    throw new Error(`Too many decimal places, max ${decimals}`);
  }

  const fraction = fractionRaw.padEnd(decimals, '0');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || '0');

  if (!allowZero && units <= 0n) {
    throw new Error('Amount must be greater than zero');
  }

  return units;
}

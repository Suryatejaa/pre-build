import { z } from 'zod';

// Decimal strings keep entered precision; binary floating point is never used for conversion.
export const decimalSchema = z.string().regex(/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/, 'Use a decimal number with up to 6 decimal places.');
export const lengthSchema = z.strictObject({ value: decimalSchema, unit: z.enum(['m', 'ft']) }).refine(v => decimalRatio(v.value).n > 0n, 'Length must be positive.');
export const areaSchema = z.strictObject({ value: decimalSchema, unit: z.enum(['m2', 'ft2', 'yd2']) }).refine(v => decimalRatio(v.value).n > 0n, 'Area must be positive.');
export type Length = z.infer<typeof lengthSchema>;
export type Area = z.infer<typeof areaSchema>;
export interface Ratio { n: bigint; d: bigint }
export function decimalRatio(value: string): Ratio {
  decimalSchema.parse(value);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  return { n: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n), d: 10n ** BigInt(fraction.length) };
}
export function roundedDivide(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const absolute = n < 0n ? -n : n;
  return sign * ((absolute * 2n + d) / (2n * d));
}
export function ratioDecimal(n: bigint, d: bigint, places = 6): string {
  const scaled = roundedDivide(n * 10n ** BigInt(places), d);
  const sign = scaled < 0n ? '-' : '';
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(places + 1, '0');
  return places === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '');
}
export function coordinateMm(value: string, unit: Length['unit']): number {
  const ratio = decimalRatio(value);
  const mm = roundedDivide(ratio.n * (unit === 'm' ? 1000n : 1524n), ratio.d * (unit === 'm' ? 1n : 5n));
  if (mm < -10_000_000n || mm > 10_000_000n) throw new Error('Coordinates must be within 10 km of the local origin.');
  return Number(mm);
}
export function lengthMm(input: Length): number {
  const value = lengthSchema.parse(input);
  const mm = coordinateMm(value.value, value.unit);
  if (mm <= 0) throw new Error('Length must be at least 1 mm after conversion.');
  return mm;
}
export function areaMm2(input: Area): Ratio {
  const value = areaSchema.parse(input);
  const ratio = decimalRatio(value.value);
  const factor = { m2: 100_000_000n, ft2: 9_290_304n, yd2: 83_612_736n }[value.unit];
  return { n: ratio.n * factor, d: ratio.d * 100n };
}
export function degreesToMilliDegrees(value: string): number {
  const ratio = decimalRatio(value);
  if (ratio.n < 0n || ratio.n >= ratio.d * 360n) throw new Error('North direction must be from 0 up to, but not including, 360 degrees.');
  const result = roundedDivide(ratio.n * 1000n, ratio.d);
  if (result >= 360000n) throw new Error('North direction rounds to 360 degrees. Use 0 instead.');
  return Number(result);
}
export function displayArea(area: { value: string; unit: 'mm2' }, unit: Area['unit'] = 'm2') {
  // Calculated mm² values have at most one fractional digit.
  const ratio = decimalRatio(area.value);
  const factor = areaMm2({ value: '1', unit });
  return ratioDecimal(ratio.n * factor.d, ratio.d * factor.n, 3);
}

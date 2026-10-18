export const MINOR_PER_MAJOR = 100;

export function decimalToFraction(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new RangeError(`Invalid non-negative decimal: ${text}`);
  const [whole, fraction = ""] = text.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length)
  };
}

export function parseMinorUnits(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new RangeError(`Invalid amount (expected a non-negative amount with up to 2 decimal places): ${text}`);
  }
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("The amount exceeds the safe integer money range.");
  return Number(result);
}

export function roundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("The denominator must be positive.");
  if (numerator < 0n) return -roundHalfUp(-numerator, denominator);
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("The rounded money amount exceeds the safe integer range.");
  return Number(rounded);
}

export function convertMinorToGBP(sourceMinor, rate) {
  if (!Number.isSafeInteger(sourceMinor) || sourceMinor < 0) {
    throw new RangeError("The source amount must be non-negative integer minor units.");
  }
  const { numerator, denominator } = decimalToFraction(rate);
  return roundHalfUp(BigInt(sourceMinor) * numerator, denominator);
}

export function percentOfMinor(amountMinor, percent) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("The amount must be non-negative integer minor units.");
  }
  const { numerator, denominator } = decimalToFraction(percent);
  return roundHalfUp(BigInt(amountMinor) * numerator, denominator * 100n);
}

export function formatGBP(minor, locale = "en-GB") {
  if (!Number.isSafeInteger(minor)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / MINOR_PER_MAJOR);
}

export function formatMinor(minor, locale = "en-GB") {
  if (!Number.isSafeInteger(minor)) return "—";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / MINOR_PER_MAJOR);
}

export function sumMinor(values) {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new RangeError("The total exceeds the safe integer money range.");
    return next;
  }, 0);
}

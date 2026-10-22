/**
 * Multi-currency support for Ajosave
 * Handles conversion from fiat currencies (NGN, GBP, USD, EUR) to USDC
 */

export type SupportedCurrency = "NGN" | "GBP" | "USD" | "EUR";

/**
 * Currencies a user can choose to display contribution amounts in (diaspora mode).
 * NGN is the settlement currency Paystack charges; USD/GBP are display-only.
 */
export type DisplayCurrency = "NGN" | "USD" | "GBP";

// Exchange rates to USDC (1 USDC = X currency units)
// In production, fetch from a live API like CoinGecko, Binance, or a forex provider
const EXCHANGE_RATES: Record<SupportedCurrency, number> = {
  NGN: 1600, // 1 USDC = 1600 NGN
  GBP: 0.79, // 1 USDC = 0.79 GBP
  USD: 1.0, // 1 USDC = 1 USD
  EUR: 0.92, // 1 USDC = 0.92 EUR
};

/**
 * Convert fiat currency amount to USDC
 * @param amount - Amount in fiat currency
 * @param currency - Currency code (NGN, GBP, USD, EUR)
 * @returns USDC amount as string with 7 decimal places
 */
export function fiatToUsdc(amount: number, currency: SupportedCurrency): string {
  const rate = EXCHANGE_RATES[currency];
  if (!rate) throw new Error(`Unsupported currency: ${currency}`);
  return (amount / rate).toFixed(7);
}

/**
 * Convert USDC amount to fiat currency
 * @param usdcAmount - Amount in USDC
 * @param currency - Target currency code
 * @returns Fiat amount rounded to 2 decimal places
 */
export function usdcToFiat(usdcAmount: string, currency: SupportedCurrency): number {
  const rate = EXCHANGE_RATES[currency];
  if (!rate) throw new Error(`Unsupported currency: ${currency}`);
  return parseFloat((parseFloat(usdcAmount) * rate).toFixed(2));
}

/**
 * Get the smallest unit multiplier for a currency (e.g., kobo for NGN, pence for GBP)
 * @param currency - Currency code
 * @returns Multiplier (100 for most currencies)
 */
export function getSmallestUnitMultiplier(_currency: SupportedCurrency): number {
  // All supported currencies use 100 as the smallest unit multiplier
  return 100;
}

/**
 * Convert fiat amount to smallest unit (e.g., NGN to kobo, GBP to pence)
 * @param amount - Amount in main currency unit
 * @param currency - Currency code
 * @returns Amount in smallest unit
 */
export function toSmallestUnit(amount: number, currency: SupportedCurrency): number {
  return Math.round(amount * getSmallestUnitMultiplier(currency));
}

/**
 * Get currency symbol for display
 * @param currency - Currency code
 * @returns Currency symbol
 */
export function getCurrencySymbol(currency: SupportedCurrency): string {
  const symbols: Record<SupportedCurrency, string> = {
    NGN: "₦",
    GBP: "£",
    USD: "$",
    EUR: "€",
  };
  return symbols[currency];
}

/**
 * Format currency amount for display
 * @param amount - Amount to format
 * @param currency - Currency code
 * @returns Formatted string (e.g., "₦1,000.00")
 */
export function formatCurrency(amount: number, currency: SupportedCurrency): string {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Validate if a currency is supported
 * @param currency - Currency code to validate
 * @returns true if supported
 */
export function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return ["NGN", "GBP", "USD", "EUR"].includes(currency);
}

/**
 * Validate if a currency is a valid display currency (diaspora mode)
 * @param currency - Currency code to validate
 * @returns true if supported for display
 */
export function isDisplayCurrency(currency: string): currency is DisplayCurrency {
  return ["NGN", "USD", "GBP"].includes(currency);
}

/**
 * Convert an NGN amount into the user's preferred display currency.
 * Uses the same USDC-pivot rates as the rest of the module so displayed
 * amounts stay consistent with settlement.
 * @param ngnAmount - Amount in NGN (what Paystack charges)
 * @param target - Target display currency
 * @returns Amount in the target currency rounded to 2 decimal places
 */
export function convertFromNgn(ngnAmount: number, target: DisplayCurrency): number {
  if (target === "NGN") return parseFloat(ngnAmount.toFixed(2));
  const usdc = ngnAmount / EXCHANGE_RATES.NGN;
  return parseFloat((usdc * EXCHANGE_RATES[target]).toFixed(2));
}

/**
 * Get the FX rate for converting NGN into a display currency.
 * @param target - Target display currency
 * @returns Units of target currency per 1 NGN
 */
export function getNgnToDisplayRate(target: DisplayCurrency): number {
  if (target === "NGN") return 1;
  return EXCHANGE_RATES[target] / EXCHANGE_RATES.NGN;
}

export interface ConvertedAmount {
  /** Amount in NGN — the amount Paystack actually charges */
  ngnAmount: number;
  /** Amount in the user's preferred display currency */
  displayAmount: number;
  /** The display currency used */
  displayCurrency: DisplayCurrency;
  /** Units of display currency per 1 NGN */
  rate: number;
  /** ISO timestamp of when the rate was resolved */
  rateTimestamp: string;
  /** Disclaimer shown alongside the FX rate */
  disclaimer: string;
}

/**
 * Convert an NGN contribution amount into the user's display currency,
 * returning both amounts plus FX metadata (rate, timestamp, disclaimer).
 * @param ngnAmount - Amount in NGN (what Paystack charges)
 * @param displayCurrency - User's preferred display currency
 * @returns Converted amounts and FX metadata
 */
export function convertContribution(
  ngnAmount: number,
  displayCurrency: DisplayCurrency
): ConvertedAmount {
  return {
    ngnAmount: parseFloat(ngnAmount.toFixed(2)),
    displayAmount: convertFromNgn(ngnAmount, displayCurrency),
    displayCurrency,
    rate: getNgnToDisplayRate(displayCurrency),
    rateTimestamp: new Date().toISOString(),
    disclaimer: "Rate may vary",
  };
}

/**
 * Format the FX rate line for display, e.g.
 * "1 NGN = $0.000625 · Rate may vary · Updated 2024-01-01T00:00:00.000Z"
 * @param converted - Result of convertContribution
 * @returns Human-readable FX rate string with timestamp and disclaimer
 */
export function formatFxRate(converted: ConvertedAmount): string {
  const symbol = getCurrencySymbol(converted.displayCurrency);
  const rate = converted.rate.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  return `1 NGN = ${symbol}${rate} · ${converted.disclaimer} · Updated ${converted.rateTimestamp}`;
}

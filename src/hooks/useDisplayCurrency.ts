import { useCallback, useEffect, useMemo, useState } from 'react';

export type DisplayCurrency = 'NGN' | 'USD' | 'GBP';

const STORAGE_KEY = 'display_currency';
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/NGN';
const FX_CACHE_TTL_MS = 5 * 60 * 1000;

interface FxCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

interface FxState {
  rates: Record<string, number>;
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
}

function readStoredCurrency(): DisplayCurrency {
  if (typeof window === 'undefined') return 'NGN';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'USD' || stored === 'GBP' || stored === 'NGN') return stored;
  return 'NGN';
}

function readCache(): FxCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}_fx_cache`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FxCache;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.rates) return null;
    if (Date.now() - parsed.fetchedAt > FX_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: FxCache): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_KEY}_fx_cache`, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
}

/**
 * Diaspora mode: user preference for the currency contribution amounts are
 * displayed in, plus live NGN-based FX conversion. NGN is always the amount
 * Paystack charges; USD/GBP are display-only conversions.
 */
export function useDisplayCurrency() {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>(readStoredCurrency);
  const [fx, setFx] = useState<FxState>(() => {
    const cached = readCache();
    return {
      rates: cached?.rates ?? { NGN: 1 },
      fetchedAt: cached?.fetchedAt ?? null,
      loading: !cached,
      error: null,
    };
  });

  const setDisplayCurrency = useCallback((currency: DisplayCurrency) => {
    setDisplayCurrencyState(currency);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, currency);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRates() {
      const cached = readCache();
      if (cached) {
        setFx({ rates: cached.rates, fetchedAt: cached.fetchedAt, loading: false, error: null });
        return;
      }
      try {
        const res = await fetch(FX_ENDPOINT);
        if (!res.ok) throw new Error(`FX request failed: ${res.status}`);
        const data = (await res.json()) as { rates?: Record<string, number> };
        if (cancelled) return;
        const rates = { NGN: 1, ...(data.rates ?? {}) };
        const fetchedAt = Date.now();
        writeCache({ rates, fetchedAt });
        setFx({ rates, fetchedAt, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setFx((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unable to load FX rates',
        }));
      }
    }

    loadRates();
    return () => {
      cancelled = true;
    };
  }, []);

  const rate = useMemo(() => {
    if (displayCurrency === 'NGN') return 1;
    return fx.rates[displayCurrency] ?? null;
  }, [displayCurrency, fx.rates]);

  const convertFromNgn = useCallback(
    (amountNgn: number): number | null => {
      if (displayCurrency === 'NGN') return amountNgn;
      if (rate == null) return null;
      return amountNgn * rate;
    },
    [displayCurrency, rate],
  );

  const format = useCallback(
    (amountNgn: number): string => {
      const converted = convertFromNgn(amountNgn);
      if (converted == null) {
        return new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
          maximumFractionDigits: 0,
        }).format(amountNgn);
      }
      return new Intl.NumberFormat(displayCurrency === 'NGN' ? 'en-NG' : 'en-US', {
        style: 'currency',
        currency: displayCurrency,
        maximumFractionDigits: displayCurrency === 'NGN' ? 0 : 2,
      }).format(converted);
    },
    [convertFromNgn, displayCurrency],
  );

  const fxTimestamp = fx.fetchedAt ? new Date(fx.fetchedAt) : null;

  return {
    displayCurrency,
    setDisplayCurrency,
    rate,
    convertFromNgn,
    format,
    fxTimestamp,
    fxLoading: fx.loading,
    fxError: fx.error,
    isDiaspora: displayCurrency !== 'NGN',
  };
}

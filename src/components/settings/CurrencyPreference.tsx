import { useEffect, useState } from 'react';

export type DisplayCurrency = 'NGN' | 'USD' | 'GBP';

const CURRENCIES: DisplayCurrency[] = ['NGN', 'USD', 'GBP'];

const STORAGE_KEY = 'display_currency';

interface FxRate {
  rate: number;
  fetchedAt: string;
}

interface CurrencyPreferenceProps {
  value?: DisplayCurrency;
  onChange?: (currency: DisplayCurrency) => void;
}

function readStoredCurrency(): DisplayCurrency {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'NGN' || stored === 'USD' || stored === 'GBP') {
      return stored;
    }
  } catch {
    // ignore storage access errors
  }
  return 'NGN';
}

export default function CurrencyPreference({ value, onChange }: CurrencyPreferenceProps) {
  const [currency, setCurrency] = useState<DisplayCurrency>(value ?? readStoredCurrency());
  const [fx, setFx] = useState<FxRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value && value !== currency) {
      setCurrency(value);
    }
  }, [value]);

  useEffect(() => {
    if (currency === 'NGN') {
      setFx(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/fx/rate?from=NGN&to=${currency}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to load FX rate');
        }
        return res.json();
      })
      .then((data: { rate: number; fetchedAt?: string }) => {
        if (cancelled) return;
        setFx({
          rate: data.rate,
          fetchedAt: data.fetchedAt ?? new Date().toISOString(),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFx(null);
        setError('Unable to load live FX rate. Amounts shown in NGN.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currency]);

  const handleSelect = (next: DisplayCurrency) => {
    setCurrency(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage access errors
    }
    onChange?.(next);
  };

  return (
    <div className="currency-preference">
      <h3>Display currency</h3>
      <p className="currency-preference__hint">
        Choose the currency used to display contribution amounts. Circle configuration is not
        affected.
      </p>

      <div className="currency-preference__options" role="radiogroup" aria-label="Display currency">
        {CURRENCIES.map((option) => (
          <label key={option} className="currency-preference__option">
            <input
              type="radio"
              name="display_currency"
              value={option}
              checked={currency === option}
              onChange={() => handleSelect(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>

      {currency !== 'NGN' && (
        <div className="currency-preference__fx">
          {loading && <span>Loading live FX rate…</span>}
          {!loading && fx && (
            <span>
              1 NGN = {fx.rate.toFixed(4)} {currency} · Updated{' '}
              {new Date(fx.fetchedAt).toLocaleString()} · Rate may vary
            </span>
          )}
          {!loading && error && <span className="currency-preference__error">{error}</span>}
        </div>
      )}
    </div>
  );
}

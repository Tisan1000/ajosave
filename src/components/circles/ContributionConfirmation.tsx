import { useEffect, useMemo, useState } from 'react';
import { useUserSettings } from '../../hooks/useUserSettings';
import { formatCurrency, convertFromNGN, type DisplayCurrency } from '../../lib/currency';
import { fetchFxRate, type FxRate } from '../../lib/fx';

type ContributionConfirmationProps = {
  amountNgn: number;
  circleName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ContributionConfirmation({
  amountNgn,
  circleName,
  onConfirm,
  onCancel,
}: ContributionConfirmationProps) {
  const { settings } = useUserSettings();
  const displayCurrency: DisplayCurrency = settings?.display_currency ?? 'NGN';
  const [fxRate, setFxRate] = useState<FxRate | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);

  useEffect(() => {
    if (displayCurrency === 'NGN') {
      setFxRate(null);
      setFxError(null);
      return;
    }

    let cancelled = false;
    fetchFxRate(displayCurrency)
      .then((rate) => {
        if (!cancelled) {
          setFxRate(rate);
          setFxError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFxError('Unable to load live FX rate.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  const displayedAmount = useMemo(() => {
    if (displayCurrency === 'NGN' || !fxRate) {
      return null;
    }
    return convertFromNGN(amountNgn, fxRate.rate);
  }, [amountNgn, displayCurrency, fxRate]);

  const isDiaspora = displayCurrency !== 'NGN';

  return (
    <div className="contribution-confirmation">
      <h2>Confirm contribution</h2>
      <p className="contribution-confirmation__circle">{circleName}</p>

      <dl className="contribution-confirmation__amounts">
        <div>
          <dt>Paystack charges</dt>
          <dd>{formatCurrency(amountNgn, 'NGN')}</dd>
        </div>

        {isDiaspora && (
          <div>
            <dt>You pay (displayed)</dt>
            <dd>
              {displayedAmount !== null
                ? formatCurrency(displayedAmount, displayCurrency)
                : fxError ?? 'Loading FX rate…'}
            </dd>
          </div>
        )}
      </dl>

      {isDiaspora && fxRate && (
        <p className="contribution-confirmation__fx-note">
          Rate: 1 NGN = {fxRate.rate.toFixed(4)} {displayCurrency} ·{' '}
          {new Date(fxRate.timestamp).toLocaleString()} · Rate may vary
        </p>
      )}

      <div className="contribution-confirmation__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={isDiaspora && !fxRate}>
          Confirm
        </button>
      </div>
    </div>
  );
}

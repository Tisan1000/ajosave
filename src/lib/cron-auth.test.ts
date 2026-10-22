import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { verifyCronRequest, signCronRequest } from './cron-auth';

const CURRENT_SECRET = 'current-secret-value';
const PREVIOUS_SECRET = 'previous-secret-value';

function buildRequest(opts: {
  secret: string;
  timestamp: number;
  method?: string;
  path?: string;
  signatureOverride?: string;
}): Request {
  const method = opts.method ?? 'POST';
  const path = opts.path ?? '/api/cron/cycle';
  const signature =
    opts.signatureOverride ??
    createHmac('sha256', opts.secret)
      .update(`${opts.timestamp}${method}${path}`)
      .digest('hex');

  return new Request(`https://example.com${path}`, {
    method,
    headers: {
      'x-cron-timestamp': String(opts.timestamp),
      'x-cron-signature': signature,
    },
  });
}

describe('cron-auth request signing', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_HMAC_SECRET', CURRENT_SECRET);
    vi.stubEnv('CRON_HMAC_SECRET_PREVIOUS', PREVIOUS_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('accepts a valid signed request', () => {
    const now = Date.now();
    const req = buildRequest({ secret: CURRENT_SECRET, timestamp: now });
    expect(verifyCronRequest(req)).toBe(true);
  });

  it('rejects a tampered request', () => {
    const now = Date.now();
    const req = buildRequest({
      secret: CURRENT_SECRET,
      timestamp: now,
      signatureOverride: 'deadbeef',
    });
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('rejects a request with an expired timestamp (> 5 minutes old)', () => {
    const stale = Date.now() - 6 * 60 * 1000;
    const req = buildRequest({ secret: CURRENT_SECRET, timestamp: stale });
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('rejects a replayed old signed request', () => {
    const old = Date.now() - 10 * 60 * 1000;
    const req = buildRequest({ secret: CURRENT_SECRET, timestamp: old });
    // First submission is already expired; replay must also be rejected.
    expect(verifyCronRequest(req)).toBe(false);
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('accepts a request signed with the previous key during rotation', () => {
    const now = Date.now();
    const req = buildRequest({ secret: PREVIOUS_SECRET, timestamp: now });
    expect(verifyCronRequest(req)).toBe(true);
  });

  it('rejects a request signed with an unknown key', () => {
    const now = Date.now();
    const req = buildRequest({ secret: 'unknown-secret', timestamp: now });
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('signCronRequest produces a signature verifiable by verifyCronRequest', () => {
    const now = Date.now();
    const signature = signCronRequest({
      secret: CURRENT_SECRET,
      timestamp: now,
      method: 'POST',
      path: '/api/cron/reminders',
    });
    const req = buildRequest({
      secret: CURRENT_SECRET,
      timestamp: now,
      method: 'POST',
      path: '/api/cron/reminders',
      signatureOverride: signature,
    });
    expect(verifyCronRequest(req)).toBe(true);
  });
});

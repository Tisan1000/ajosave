import crypto from 'crypto';
import { db } from '../../lib/db';
import { sendEmail } from '../../lib/email';
import { sendSms } from '../../lib/sms';
import { getCountryFromIp } from '../../lib/geo';
import { logger } from '../../lib/logger';

export interface SessionFingerprint {
  ip: string;
  userAgent: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  fingerprintHash: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastSeenAt: Date;
}

const ALERT_COOLDOWN_DAYS = 30;

export function computeFingerprintHash(fp: SessionFingerprint): string {
  return crypto
    .createHash('sha256')
    .update(`${fp.ip}|${fp.userAgent}`)
    .digest('hex');
}

function detectDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'Tablet';
  if (/mobi|android|iphone/.test(ua)) return 'Mobile';
  if (/bot|crawler|spider/.test(ua)) return 'Bot';
  return 'Desktop';
}

function buildRevokeUrl(sessionId: string): string {
  const base = process.env.APP_BASE_URL ?? 'https://app.example.com';
  return `${base}/auth/revoke-other-sessions?session=${encodeURIComponent(sessionId)}`;
}

/**
 * Records a login session and, if the fingerprint is new, sends a new-device
 * alert to the user. Returns the created session record.
 */
export async function recordLogin(
  userId: string,
  fp: SessionFingerprint,
): Promise<SessionRecord> {
  const fingerprintHash = computeFingerprintHash(fp);
  const now = new Date();

  const knownSessions = await db.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const isKnownFingerprint = knownSessions.some(
    (s) => s.fingerprintHash === fingerprintHash,
  );

  const session = await db.session.create({
    data: {
      userId,
      fingerprintHash,
      ip: fp.ip,
      userAgent: fp.userAgent,
      createdAt: now,
      lastSeenAt: now,
    },
  });

  if (!isKnownFingerprint) {
    await sendNewDeviceAlert(userId, session).catch((err) => {
      logger.error('Failed to send new-device alert', { userId, err });
    });
  }

  return session;
}

async function sendNewDeviceAlert(
  userId: string,
  session: SessionRecord,
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const deviceType = detectDeviceType(session.userAgent);
  const country = await getCountryFromIp(session.ip).catch(() => 'Unknown');
  const timestamp = session.createdAt.toISOString();
  const revokeUrl = buildRevokeUrl(session.id);

  const message =
    `New login detected on your account.\n\n` +
    `Device: ${deviceType}\n` +
    `Location: ${country}\n` +
    `Time: ${timestamp}\n\n` +
    `If this was not you, revoke access immediately: ${revokeUrl}`;

  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'New device login to your account',
      text: message,
    });
    return;
  }

  if (user.phone) {
    await sendSms({ to: user.phone, body: message });
  }
}

/**
 * Revokes all sessions for a user except the most recently created one.
 * Used by the 'Not you? Revoke access' link.
 */
export async function revokeOtherSessions(userId: string): Promise<number> {
  const latest = await db.session.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (!latest) return 0;

  const result = await db.session.deleteMany({
    where: {
      userId,
      id: { not: latest.id },
    },
  });

  return result.count;
}

/**
 * Handles the 'Not you? Revoke access' link. Revokes all sessions except the
 * most recently created one for the session's owner.
 */
export async function handleRevokeLink(sessionId: string): Promise<number> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return 0;
  return revokeOtherSessions(session.userId);
}

export const NEW_DEVICE_ALERT_COOLDOWN_DAYS = ALERT_COOLDOWN_DAYS;

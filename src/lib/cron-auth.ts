import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Cron request signing (HMAC-SHA256).
 *
 * Callers must send:
 *   x-cron-timestamp: <unix seconds>
 *   x-cron-signature: HMAC-SHA256(secret, `${timestamp}${method}${path}`) as hex
 *
 * Two-key rotation: set CRON_SECRET (current) and optionally CRON_SECRET_PREVIOUS
 * (previous). Both are accepted during the rotation window so keys can be
 * rotated without downtime.
 */

const MAX_SKEW_SECONDS = 5 * 60;

function getSecrets(): string[] {
  const secrets = [process.env.CRON_SECRET, process.env.CRON_SECRET_PREVIOUS].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  return secrets;
}

function sign(secret: string, timestamp: string, method: string, path: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}${method}${path}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a signed cron request. Returns a NextResponse on failure, or null
 * when the request is authentic.
 */
export async function verifyCronSecret(req: NextRequest): Promise<NextResponse | null> {
  const secrets = getSecrets();
  if (secrets.length === 0) {
    return NextResponse.json(
      { success: false, error: "Cron authentication is not configured" },
      { status: 500 }
    );
  }

  const timestamp = req.headers.get("x-cron-timestamp");
  const signature = req.headers.get("x-cron-signature");

  if (!timestamp || !signature) {
    return NextResponse.json(
      { success: false, error: "Missing cron signature headers" },
      { status: 401 }
    );
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return NextResponse.json(
      { success: false, error: "Invalid cron timestamp" },
      { status: 401 }
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return NextResponse.json(
      { success: false, error: "Cron timestamp expired" },
      { status: 401 }
    );
  }

  const method = req.method.toUpperCase();
  const path = req.nextUrl.pathname;

  const valid = secrets.some((secret) =>
    safeEqual(sign(secret, timestamp, method, path), signature)
  );

  if (!valid) {
    return NextResponse.json(
      { success: false, error: "Invalid cron signature" },
      { status: 401 }
    );
  }

  return null;
}

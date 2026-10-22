import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler } from "@/server/middleware";
import {
  getContributionsByCircle,
  getContributionsByCircleFiltered,
  isCircleMember,
} from "@/server/services/contribution.service";
import {
  encodeCursor,
  parseCursorParams,
} from "@/lib/pagination";
import type { ApiResponse } from "@/types";
import type { ContributionRow } from "@/server/services/contribution.service";

const VALID_STATUSES = new Set(["paid", "pending", "failed", "partial", "confirmed"]);

export const GET = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const { id } = (ctx as { params: { id: string } }).params;
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  // ── Auth: require an authenticated session ──────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }
  const userId = (session.user as { id: string }).id;
  const userRole = (session.user as { role?: string }).role;

  // ── Authorization: members can read, admins can read all, others 403 ──────
  const { isMember, isAdmin } = await isCircleMember(id, userId);
  const isPlatformAdmin = userRole === "admin";
  if (!isMember && !isAdmin && !isPlatformAdmin) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  // ── Parse query params ───────────────────────────────────────────────────
  const cycleRaw = searchParams.get("cycle");
  const cycle = cycleRaw ? parseInt(cycleRaw, 10) : undefined;
  if (cycle !== undefined && (!Number.isFinite(cycle) || cycle < 1)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid cycle parameter", code: "INVALID_CYCLE" },
      { status: 400 }
    );
  }

  const statusRaw = searchParams.get("status");
  if (statusRaw && !VALID_STATUSES.has(statusRaw)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid status parameter", code: "INVALID_STATUS" },
      { status: 400 }
    );
  }
  // Normalise "paid" → "confirmed" (DB stores "confirmed")
  const status = statusRaw === "paid" ? "confirmed" : statusRaw ?? undefined;

  // ── Legacy offset pagination (backward compat) ──────────────────────────
  // If `page` is present, use the old page/limit response shape so existing
  // clients (e.g. ContributionHistory component) keep working.
  if (searchParams.has("page")) {
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

    // Apply filters even in legacy mode
    const { data, total } = await getContributionsByCircle(id, page, limit);
    return NextResponse.json<
      ApiResponse<{ data: ContributionRow[]; total: number; page: number; limit: number }>
    >({
      success: true,
      data: { data, total, page, limit },
    });
  }

  // ── Cursor-based pagination (new default) ────────────────────────────────
  const { limit, cursor: decodedCursor } = parseCursorParams(searchParams);

  const { items, nextCursor, hasMore, total } =
    await getContributionsByCircleFiltered(
      id,
      { cycle, status },
      decodedCursor,
      limit
    );

  return NextResponse.json<
    ApiResponse<{
      items: ContributionRow[];
      nextCursor: string | null;
      hasMore: boolean;
      total: number;
    }>
  >({
    success: true,
    data: {
      items,
      nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
      hasMore,
      total,
    },
  });
});

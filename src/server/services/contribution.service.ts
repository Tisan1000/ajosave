import { query } from "@/lib/db";
import { randomUUID } from "crypto";
import type { Contribution } from "@/types";

export interface ContributionRow {
  id: string;
  cycleNumber: number;
  amountUsdc: string;
  status: string;
  createdAt: string;
  memberName: string;
  memberId: string;
  /** Currency of the contribution (e.g. NGN, USD). */
  currency?: string;
  /** Timestamp of the confirmed payment (may differ from createdAt). */
  paidAt?: string | null;
}

/** Query filters accepted by `getContributionsByCircleFiltered`. */
export interface ContributionFilters {
  /** Filter by cycle number (1-indexed). */
  cycle?: number;
  /** Filter by contribution status: pending, confirmed, failed, refunded. */
  status?: string;
}

/**
 * Return contributions for a circle with optional cycle/status filters and
 * cursor-based pagination.
 *
 * @param circleId  - The circle to list contributions for
 * @param filters   - Optional cycle and status filters
 * @param cursor    - Encoded cursor from a previous page (or undefined)
 * @param limit     - Page size (capped at 100 by the caller)
 */
export async function getContributionsByCircleFiltered(
  circleId: string,
  filters: ContributionFilters = {},
  cursor?: string,
  limit: number = 20
): Promise<{
  items: ContributionRow[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}> {
  const conditions: string[] = ["c.circle_id = $1"];
  const params: unknown[] = [circleId];
  let idx = 2;

  if (filters.cycle !== undefined) {
    conditions.push(`c.cycle_number = $${idx++}`);
    params.push(filters.cycle);
  }

  if (filters.status) {
    conditions.push(`c.status = $${idx++}`);
    params.push(filters.status);
  }

  if (cursor) {
    conditions.push(`c.created_at < $${idx++}`);
    params.push(cursor);
  }

  const whereClause = conditions.join(" AND ");

  // Fetch limit + 1 rows to detect whether a next page exists without COUNT.
  params.push(limit + 1);
  const limitPlaceholder = `$${idx++}`;

  const { rows } = await query<ContributionRow>(
    `SELECT
       c.id,
       c.cycle_number        AS "cycleNumber",
       c.amount_usdc         AS "amountUsdc",
       c.status              AS "status",
       c.created_at          AS "createdAt",
       c.paid_at             AS "paidAt",
       COALESCE(c.contribution_currency, 'NGN') AS "currency",
       COALESCE(u.display_name, 'Unknown')     AS "memberName",
       m.id                  AS "memberId"
     FROM contributions c
     JOIN members m ON m.id = c.member_id
     JOIN users u   ON u.id = m.user_id
     WHERE ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT ${limitPlaceholder}`,
    params
  );

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? (lastItem.createdAt as string) : null;

  // Total count for the filtered set (for UI pagination metadata)
  const { rows: countRows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM contributions c
     WHERE ${conditions
       .filter((c) => !c.includes("c.created_at <"))
       .join(" AND ")}`,
    params.slice(0, idx - 2) // exclude limit placeholder + cursor param
  );

  const total = parseInt(countRows[0]?.count ?? "0", 10);

  return { items, nextCursor, hasMore, total };
}

/**
 * Legacy paginated contributions query (kept for backward compatibility with
 * the existing ContributionHistory component which uses page/limit).
 */
export async function getContributionsByCircle(
  circleId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ data: ContributionRow[]; total: number }> {
  const offset = (page - 1) * limit;

  const { rows } = await query<ContributionRow>(
    `SELECT
       c.id,
       c.cycle_number      AS "cycleNumber",
       c.amount_usdc      AS "amountUsdc",
       c.status           AS "status",
       c.created_at       AS "createdAt",
       COALESCE(u.display_name, 'Unknown') AS "memberName",
       m.id               AS "memberId"
     FROM contributions c
     JOIN members m ON m.id = c.member_id
     JOIN users u ON u.id = m.user_id
     WHERE c.circle_id = $1
     ORDER BY c.created_at DESC
     LIMIT $2 OFFSET $3`,
    [circleId, limit, offset]
  );

  const { rows: countRows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM contributions WHERE circle_id = $1`,
    [circleId]
  );

  const total = parseInt(countRows[0]?.count ?? "0", 10);
  return { data: rows, total };
}

/**
 * Create a pending contribution record for a member in a cycle.
 * Uses ON CONFLICT to be idempotent — safe to call multiple times.
 */
export async function createContribution(
  circleId: string,
  memberId: string,
  cycleNumber: number,
  amountUsdc: string,
  paystackReference: string
): Promise<Contribution> {
  const { rows } = await query<Contribution>(
    `INSERT INTO contributions (id, circle_id, member_id, cycle_number, amount_usdc, status, paystack_reference, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
     ON CONFLICT (member_id, cycle_number) DO UPDATE
       SET paystack_reference = EXCLUDED.paystack_reference
     RETURNING id, circle_id as "circleId", member_id as "memberId",
               cycle_number as "cycleNumber", amount_usdc as "amountUsdc",
               status, tx_hash as "txHash", created_at as "createdAt"`,
    [randomUUID(), circleId, memberId, cycleNumber, amountUsdc, paystackReference]
  );
  return rows[0];
}

/**
 * Return all members who have no confirmed contribution for the given cycle.
 * Used by the missed-contributions cron to mark defaulters.
 */
export async function getMissedContributions(
  circleId: string,
  cycleNumber: number
): Promise<{ memberId: string; userId: string }[]> {
  const { rows } = await query<{ memberId: string; userId: string }>(
    `SELECT m.id as "memberId", m.user_id as "userId"
     FROM members m
     WHERE m.circle_id = $1
       AND m.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM contributions c
         WHERE c.member_id = m.id
           AND c.circle_id = $1
           AND c.cycle_number = $2
           AND c.status = 'confirmed'
       )`,
    [circleId, cycleNumber]
  );
  return rows;
}

/**
 * Check whether a user is a member of a circle (any status).
 */
export async function isCircleMember(
  circleId: string,
  userId: string
): Promise<{ isMember: boolean; isAdmin: boolean }> {
  const { rows } = await query<{ is_member: boolean; is_admin: boolean }>(
    `SELECT
       EXISTS(SELECT 1 FROM members WHERE circle_id = $1 AND user_id = $2) AS is_member,
       EXISTS(SELECT 1 FROM circles WHERE id = $1 AND creator_id = $2)    AS is_admin`,
    [circleId, userId]
  );

  return {
    isMember: rows[0]?.is_member ?? false,
    isAdmin: rows[0]?.is_admin ?? false,
  };
}

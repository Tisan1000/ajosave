import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

const CACHE_TTL_SECONDS = 60 * 60 * 24; // daily refresh
const DISMISS_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const TOP_N = 3;

const WEIGHTS = {
  amount: 0.4,
  frequency: 0.3,
  reputation: 0.2,
  members: 0.1,
};

interface CircleCandidate {
  id: string;
  name: string;
  contributionAmount: number;
  frequency: string;
  minReputation: number | null;
  maxMembers: number | null;
  _count?: { members: number };
}

interface UserProfile {
  averageContribution: number | null;
  preferredFrequency: string | null;
  reputationScore: number;
}

function cacheKey(userId: string) {
  return `circles:recommended:${userId}`;
}

function dismissedKey(userId: string) {
  return `circles:recommended:dismissed:${userId}`;
}

function amountScore(circleAmount: number, userAmount: number | null): number {
  if (!userAmount || userAmount <= 0) return 0.5;
  const diff = Math.abs(circleAmount - userAmount);
  const ratio = diff / Math.max(circleAmount, userAmount);
  return Math.max(0, 1 - ratio);
}

function frequencyScore(circleFrequency: string, userFrequency: string | null): number {
  if (!userFrequency) return 0.5;
  return circleFrequency === userFrequency ? 1 : 0;
}

function reputationScore(minReputation: number | null, userReputation: number): number {
  if (minReputation == null) return 1;
  if (userReputation >= minReputation) return 1;
  const gap = minReputation - userReputation;
  return Math.max(0, 1 - gap / Math.max(minReputation, 1));
}

function memberScore(memberCount: number, maxMembers: number | null): number {
  if (!maxMembers || maxMembers <= 0) return 0.5;
  const fill = memberCount / maxMembers;
  // Prefer circles that are neither empty nor full.
  return Math.max(0, 1 - Math.abs(fill - 0.5) * 2);
}

function scoreCircle(circle: CircleCandidate, profile: UserProfile): number {
  const memberCount = circle._count?.members ?? 0;
  return (
    amountScore(circle.contributionAmount, profile.averageContribution) * WEIGHTS.amount +
    frequencyScore(circle.frequency, profile.preferredFrequency) * WEIGHTS.frequency +
    reputationScore(circle.minReputation, profile.reputationScore) * WEIGHTS.reputation +
    memberScore(memberCount, circle.maxMembers) * WEIGHTS.members
  );
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const cached = await redis.get(cacheKey(userId));
  if (cached) {
    return NextResponse.json({ circles: JSON.parse(cached) });
  }

  const [user, dismissedRaw] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        averageContribution: true,
        preferredFrequency: true,
        reputationScore: true,
        memberships: { select: { circleId: true } },
      },
    }),
    redis.smembers(dismissedKey(userId)),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const joinedIds = new Set(user.memberships.map((m) => m.circleId));
  const dismissedIds = new Set(dismissedRaw ?? []);

  const circles = (await prisma.circle.findMany({
    where: {
      id: { notIn: Array.from(joinedIds) },
    },
    select: {
      id: true,
      name: true,
      contributionAmount: true,
      frequency: true,
      minReputation: true,
      maxMembers: true,
      _count: { select: { members: true } },
    },
  })) as CircleCandidate[];

  const profile: UserProfile = {
    averageContribution: user.averageContribution ?? null,
    preferredFrequency: user.preferredFrequency ?? null,
    reputationScore: user.reputationScore ?? 0,
  };

  const recommended = circles
    .filter((c) => !dismissedIds.has(c.id))
    .map((circle) => ({ circle, score: scoreCircle(circle, profile) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map(({ circle, score }) => ({
      id: circle.id,
      name: circle.name,
      contributionAmount: circle.contributionAmount,
      frequency: circle.frequency,
      minReputation: circle.minReputation,
      maxMembers: circle.maxMembers,
      memberCount: circle._count?.members ?? 0,
      score: Number(score.toFixed(4)),
    }));

  await redis.set(cacheKey(userId), JSON.stringify(recommended), 'EX', CACHE_TTL_SECONDS);

  return NextResponse.json({ circles: recommended });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const circleId = body?.circleId;
  if (!circleId || typeof circleId !== 'string') {
    return NextResponse.json({ error: 'circleId is required' }, { status: 400 });
  }

  const userId = session.user.id;
  await redis.sadd(dismissedKey(userId), circleId);
  await redis.expire(dismissedKey(userId), DISMISS_TTL_SECONDS);
  await redis.del(cacheKey(userId));

  return NextResponse.json({ dismissed: circleId });
}

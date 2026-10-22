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
} as const;

export interface RecommendedCircle {
  id: string;
  name: string;
  contributionAmount: number;
  frequency: string;
  minReputation: number;
  memberCount: number;
  score: number;
}

interface UserProfile {
  preferredAmount: number | null;
  preferredFrequency: string | null;
  reputation: number;
}

interface CircleCandidate {
  id: string;
  name: string;
  contributionAmount: number;
  frequency: string;
  minReputation: number;
  memberCount: number;
}

function cacheKey(userId: string): string {
  return `circles:recommended:${userId}`;
}

function dismissKey(userId: string): string {
  return `circles:recommended:dismissed:${userId}`;
}

function amountScore(preferred: number | null, amount: number): number {
  if (!preferred || preferred <= 0) return 0.5;
  const diff = Math.abs(preferred - amount) / preferred;
  return Math.max(0, 1 - diff);
}

function frequencyScore(preferred: string | null, frequency: string): number {
  if (!preferred) return 0.5;
  return preferred === frequency ? 1 : 0;
}

function reputationScore(reputation: number, minReputation: number): number {
  if (reputation >= minReputation) return 1;
  return Math.max(0, reputation / Math.max(1, minReputation));
}

function memberScore(memberCount: number): number {
  // Favour circles with healthy but not overwhelming membership.
  return Math.min(1, memberCount / 20);
}

function scoreCircle(profile: UserProfile, circle: CircleCandidate): number {
  return (
    WEIGHTS.amount * amountScore(profile.preferredAmount, circle.contributionAmount) +
    WEIGHTS.frequency * frequencyScore(profile.preferredFrequency, circle.frequency) +
    WEIGHTS.reputation * reputationScore(profile.reputation, circle.minReputation) +
    WEIGHTS.members * memberScore(circle.memberCount)
  );
}

async function loadUserProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      reputation: true,
      preferredContributionAmount: true,
      preferredFrequency: true,
    },
  });

  return {
    reputation: user?.reputation ?? 0,
    preferredAmount: user?.preferredContributionAmount ?? null,
    preferredFrequency: user?.preferredFrequency ?? null,
  };
}

async function loadCandidates(userId: string): Promise<CircleCandidate[]> {
  const circles = await prisma.circle.findMany({
    where: {
      members: { none: { userId } },
    },
    select: {
      id: true,
      name: true,
      contributionAmount: true,
      frequency: true,
      minReputation: true,
      _count: { select: { members: true } },
    },
  });

  return circles.map((c) => ({
    id: c.id,
    name: c.name,
    contributionAmount: Number(c.contributionAmount),
    frequency: c.frequency,
    minReputation: c.minReputation ?? 0,
    memberCount: c._count.members,
  }));
}

async function getDismissed(userId: string): Promise<Set<string>> {
  const ids = await redis.smembers(dismissKey(userId));
  return new Set(ids);
}

export async function getRecommendedCircles(
  userId: string,
): Promise<RecommendedCircle[]> {
  const cached = await redis.get(cacheKey(userId));
  if (cached) {
    return JSON.parse(cached) as RecommendedCircle[];
  }

  const [profile, candidates, dismissed] = await Promise.all([
    loadUserProfile(userId),
    loadCandidates(userId),
    getDismissed(userId),
  ]);

  const recommendations = candidates
    .filter((c) => !dismissed.has(c.id))
    .map((c) => ({ ...c, score: scoreCircle(profile, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  await redis.set(
    cacheKey(userId),
    JSON.stringify(recommendations),
    'EX',
    CACHE_TTL_SECONDS,
  );

  return recommendations;
}

export async function dismissRecommendation(
  userId: string,
  circleId: string,
): Promise<void> {
  const key = dismissKey(userId);
  await redis.sadd(key, circleId);
  await redis.expire(key, DISMISS_TTL_SECONDS);
  await redis.del(cacheKey(userId));
}

export const VERIFIED_CONTRIBUTOR_THRESHOLD = 80;

export interface ReputationStats {
  reputationScore: number;
  circlesCompleted: number;
  totalSaved: number;
  onTimePaymentRate: number;
}

export interface PublicReputationProfile extends ReputationStats {
  userId: string;
  stellarAddress?: string;
  isPublic: boolean;
  isVerifiedContributor: boolean;
}

export function isVerifiedContributor(reputationScore: number): boolean {
  return reputationScore >= VERIFIED_CONTRIBUTOR_THRESHOLD;
}

export function getPublicProfilePath(userId: string): string {
  return `/u/${encodeURIComponent(userId)}`;
}

export function buildPublicReputationProfile(
  userId: string,
  stats: ReputationStats,
  options: { isPublic?: boolean; stellarAddress?: string } = {}
): PublicReputationProfile {
  return {
    userId,
    reputationScore: stats.reputationScore,
    circlesCompleted: stats.circlesCompleted,
    totalSaved: stats.totalSaved,
    onTimePaymentRate: stats.onTimePaymentRate,
    isPublic: options.isPublic ?? true,
    stellarAddress: options.stellarAddress,
    isVerifiedContributor: isVerifiedContributor(stats.reputationScore),
  };
}

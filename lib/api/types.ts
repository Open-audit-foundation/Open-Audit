export type DeveloperTier = "free" | "partner";

export interface ApiKey {
  id: string;
  prefix: "oa_live" | "oa_test";
  keyHash: string;
  appId: string;
  userId: string;
  tier: DeveloperTier;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
}

export interface DeveloperApp {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RateLimitConfig = {
  [key in DeveloperTier]: {
    requestsPerMinute: number;
  };
}

export const RATE_LIMITS: RateLimitConfig = {
  free: { requestsPerMinute: 60 },
  partner: { requestsPerMinute: 5000 },
};

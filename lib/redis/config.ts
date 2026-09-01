/** Redis connection and pub/sub configuration shared by worker and web server. */

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const REDIS_CHANNEL = process.env.REDIS_CHANNEL || "stellar:events";
export const WORKER_HEARTBEAT_KEY = "open-audit:worker:heartbeat";

export function getWorkerId(): string {
  return process.env.WORKER_ID || `worker-${process.pid}`;
}

/**
 * Server-safe metric increment helpers.
 * Avoids pulling prom-client into client bundles and Edge middleware.
 */

function isServerRuntime(): boolean {
  return typeof window === "undefined";
}

export function incRegistryCacheHit(): void {
  if (!isServerRuntime()) return;
  void import("./metrics").then((m) => m.registryCacheHitsTotal.inc());
}

export function incRegistryCacheMiss(): void {
  if (!isServerRuntime()) return;
  void import("./metrics").then((m) => m.registryCacheMissesTotal.inc());
}

export function incTranslationTotal(status: string): void {
  if (!isServerRuntime()) return;
  void import("./metrics").then((m) => m.translationsTotal.labels(status).inc());
}

export function incRedisCacheHit(): void {
  if (!isServerRuntime()) return;
  void import("./metrics").then((m) => m.redisCacheHitsTotal.inc());
}

export function incRedisCacheMiss(): void {
  if (!isServerRuntime()) return;
  void import("./metrics").then((m) => m.redisCacheMissesTotal.inc());
}

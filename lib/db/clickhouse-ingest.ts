/** ClickHouse ingestion helpers (stubbed until analytics pipeline is enabled). */

export async function bufferEvents(_events: unknown[]): Promise<void> {
  // No-op: ClickHouse batching is not configured in this deployment.
}

export async function flushEvents(): Promise<void> {
  // No-op
}

export async function updateCursorCH(_ledger: number): Promise<void> {
  // No-op
}

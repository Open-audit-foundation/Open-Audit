/**
 * Minimal ioredis stub for test environments.
 * Prevents "Failed to load url ioredis" errors when cache modules are
 * transitively imported during unit/integration tests.
 */
import { vi } from "vitest";

const RedisMock = vi.fn().mockImplementation(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}));

export default RedisMock;

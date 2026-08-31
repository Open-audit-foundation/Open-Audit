import { beforeAll, afterEach, afterAll, expect } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import * as matchers from "vitest-axe/matchers";

expect.extend(jestDomMatchers);
expect.extend(matchers);

// Use the shared MSW server so every test file that calls server.use() or
// mswTestServer.use() works against the same interceptor instance.
import { mswTestServer as server } from "@/lib/test-utils/msw-server";

// Re-export for any test files that imported `server` from this setup module.
export { server };

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

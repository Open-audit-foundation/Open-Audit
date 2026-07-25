import { beforeAll, afterEach, afterAll } from "vitest";
import { mswTestServer as server } from "@/lib/test-utils/msw-server";

export { server };

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

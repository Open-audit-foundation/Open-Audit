// Minimal ioredis mock for testing — no real Redis connection required.
class Redis {
  private store = new Map<string, string>();

  on(_event: string, _handler: (...args: unknown[]) => void): this {
    return this;
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ..._args: unknown[]): Promise<"OK"> {
    this.store.set(key, value);
    return "OK";
  }
  async quit(): Promise<"OK"> {
    return "OK";
  }
}

export default Redis;

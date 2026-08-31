import Redis from "ioredis";
import { WORKER_HEARTBEAT_KEY } from "./config";

export interface RedisPublisherOptions {
  url: string;
  workerId: string;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  maxQueueSize?: number;
}

export interface RedisPublisherStatus {
  connected: boolean;
  queueSize: number;
  reconnectAttempts: number;
}

/**
 * Redis pub/sub publisher with reconnect, publish queue, and worker heartbeat.
 * Used by the standalone indexer worker.
 */
export class RedisPublisher {
  private client: Redis | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelayMs: number;
  private isConnected = false;
  private publishQueue: Array<{ channel: string; message: string }> = [];
  private readonly maxQueueSize: number;

  constructor(private readonly options: RedisPublisherOptions) {
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxQueueSize = options.maxQueueSize ?? 1000;
  }

  async connect(): Promise<void> {
    const { url, workerId } = this.options;

    console.log(`[${workerId}] Connecting to Redis at ${url}...`);

    this.client = new Redis(url, {
      retryStrategy: (times) => {
        if (times > this.maxReconnectAttempts) {
          console.error(`[${workerId}] Max Redis reconnection attempts reached. Giving up.`);
          return null;
        }

        const delay = Math.min(times * this.reconnectDelayMs, 10000);
        console.log(`[${workerId}] Redis reconnecting in ${delay}ms (attempt ${times})...`);
        return delay;
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on("connect", () => {
      console.log(`[${workerId}] Redis connected`);
    });

    this.client.on("ready", () => {
      console.log(`[${workerId}] Redis ready`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      void this.flushQueue();
    });

    this.client.on("error", (error) => {
      console.error(`[${workerId}] Redis error:`, error.message);
      this.isConnected = false;
    });

    this.client.on("close", () => {
      console.warn(`[${workerId}] Redis connection closed`);
      this.isConnected = false;
    });

    this.client.on("reconnecting", () => {
      this.reconnectAttempts++;
      console.log(`[${workerId}] Redis reconnecting (attempt ${this.reconnectAttempts})...`);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.client) {
        reject(new Error("Redis client not initialized"));
        return;
      }

      this.client.once("ready", () => resolve());
      this.client.once("error", reject);
      setTimeout(() => reject(new Error("Redis connection timeout")), 10000);
    });

    console.log(`[${workerId}] Redis publisher ready`);
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error("Redis client not initialized. Call connect() first.");
    }

    if (!this.isConnected) {
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
        console.warn(
          `[${this.options.workerId}] Redis disconnected. Queued message (${this.publishQueue.length}/${this.maxQueueSize})`
        );
      } else {
        console.error(
          `[${this.options.workerId}] Publish queue full (${this.maxQueueSize}). Dropping message.`
        );
      }
      return;
    }

    try {
      const subscriberCount = await this.client.publish(channel, message);
      console.log(
        `[${this.options.workerId}] Published to ${channel} (${subscriberCount} subscriber(s))`
      );
    } catch (error) {
      console.error(`[${this.options.workerId}] Failed to publish to Redis:`, error);
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
      }
      throw error;
    }
  }

  async setHeartbeat(data: Record<string, unknown>): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const fields: string[] = [];
      for (const [field, value] of Object.entries(data)) {
        fields.push(field, typeof value === "string" ? value : JSON.stringify(value));
      }

      await this.client.hset(WORKER_HEARTBEAT_KEY, ...fields);
    } catch (error) {
      console.error(`[${this.options.workerId}] Failed to set heartbeat:`, error);
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.publishQueue.length === 0) return;

    console.log(`[${this.options.workerId}] Flushing ${this.publishQueue.length} queued messages...`);

    const queue = [...this.publishQueue];
    this.publishQueue = [];

    for (const { channel, message } of queue) {
      try {
        await this.publish(channel, message);
      } catch (error) {
        console.error(`[${this.options.workerId}] Failed to flush queued message:`, error);
        this.publishQueue.push({ channel, message });
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      console.log(`[${this.options.workerId}] Disconnecting Redis publisher...`);
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }

  getStatus(): RedisPublisherStatus {
    return {
      connected: this.isConnected,
      queueSize: this.publishQueue.length,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

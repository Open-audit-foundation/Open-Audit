import Redis from "ioredis";
import { parseEventMessage, toWebSocketPayload } from "../events/message-envelope";
import type { TranslatedEvent } from "../translator/types";
import { REDIS_CHANNEL, REDIS_URL } from "./config";

export interface RedisSubscriberOptions {
  url?: string;
  channel?: string;
  logPrefix?: string;
  onEvent: (event: TranslatedEvent) => void;
  onError?: (error: Error) => void;
}

export interface RedisSubscriber {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
}

/**
 * Subscribe to the indexer Redis channel and forward translated events
 * to the web server's WebSocket broadcast layer.
 */
export function createRedisSubscriber(options: RedisSubscriberOptions): RedisSubscriber {
  const {
    url = REDIS_URL,
    channel = REDIS_CHANNEL,
    logPrefix = "[RedisSubscriber]",
    onEvent,
    onError,
  } = options;

  let subscriber: Redis | null = null;
  let connected = false;

  return {
    async connect(): Promise<void> {
      console.log(`${logPrefix} Connecting to Redis at ${url} (channel: ${channel})...`);

      subscriber = new Redis(url, {
        retryStrategy: (times) => Math.min(times * 500, 5000),
        enableReadyCheck: true,
        maxRetriesPerRequest: null,
      });

      subscriber.on("error", (error) => {
        console.error(`${logPrefix} Redis error:`, error.message);
        connected = false;
        onError?.(error);
      });

      subscriber.on("close", () => {
        console.warn(`${logPrefix} Redis connection closed`);
        connected = false;
      });

      subscriber.on("ready", () => {
        connected = true;
        console.log(`${logPrefix} Redis subscriber ready`);
      });

      subscriber.on("message", (receivedChannel, message) => {
        if (receivedChannel !== channel) return;

        const envelope = parseEventMessage(message);
        if (!envelope) {
          console.warn(`${logPrefix} Ignoring invalid pub/sub payload`);
          return;
        }

        onEvent(toWebSocketPayload(envelope));
      });

      await subscriber.subscribe(channel);
      connected = true;
      console.log(`${logPrefix} Subscribed to ${channel}`);
    },

    async disconnect(): Promise<void> {
      if (!subscriber) return;

      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } finally {
        subscriber = null;
        connected = false;
        console.log(`${logPrefix} Disconnected`);
      }
    },

    isConnected(): boolean {
      return connected;
    },
  };
}

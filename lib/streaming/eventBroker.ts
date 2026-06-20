/**
 * In-process event broker — singleton pub/sub hub.
 *
 * The indexer publishes translated events here; SSE route handlers subscribe
 * with an optional filter so each client only receives what it asked for.
 */
import type { TranslatedEvent } from "../translator/types";

export interface StreamFilter {
  /** Only deliver events from this contract address. */
  contractId?: string;
  /** Only deliver events whose description or eventType contains this string. */
  search?: string;
}

type Subscriber = {
  filter: StreamFilter;
  callback: (event: TranslatedEvent) => void;
};

class EventBroker {
  private subscribers = new Set<Subscriber>();

  subscribe(filter: StreamFilter, callback: (event: TranslatedEvent) => void): () => void {
    const sub: Subscriber = { filter, callback };
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  publish(event: TranslatedEvent): void {
    for (const sub of this.subscribers) {
      if (this.matches(event, sub.filter)) {
        sub.callback(event);
      }
    }
  }

  private matches(event: TranslatedEvent, filter: StreamFilter): boolean {
    if (filter.contractId && event.raw.contractId !== filter.contractId) {
      return false;
    }
    if (filter.search) {
      const needle = filter.search.toLowerCase();
      const haystack = `${event.description ?? ""} ${event.eventType ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }
}

// Singleton — shared across the server process.
const broker = new EventBroker();
export default broker;

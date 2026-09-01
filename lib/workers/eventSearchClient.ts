"use client";

import type { TranslatedEvent } from "../translator/types";
import type {
    BuildIndexRequest,
    BuildIndexResponse,
    SearchRequest,
    SearchResponse,
    SearchError,
    AddEventsRequest,
    AddEventsResponse,
    RemoveEventsRequest,
    RemoveEventsResponse,
} from "./eventSearch.worker";

type PendingMap = Map<string, {
    resolve: (v: any) => void;
    reject: (e: any) => void;
}>;

function safeWorkerPath(): string {
    // Next.js resolves worker URL differently depending on bundler.
    // `new URL(..., import.meta.url)` works with webpack + next.
    return new URL("./eventSearch.worker.ts", import.meta.url).toString();
}

/**
 * Client wrapper for the in-browser event search worker.
 *
 * Provides an ergonomic API over the raw postMessage protocol:
 * - buildIndex(events, hash) — full rebuild
 * - addEvents(events) — incremental update (append new events)
 * - removeEvents(eventIds) — remove events by ID
 * - search(query, opts) — search the index
 * - destroy() — terminate the worker
 *
 * Worker lifecycle is managed automatically: the worker is lazily
 * instantiated on first use and terminated on destroy().
 */
export class EventSearchClient {
    private worker: Worker | null = null;
    private pending: PendingMap = new Map();
    private builtForEventsHash: string | null = null;
    private destroyed = false;

    private ensureWorker() {
        if (this.worker || this.destroyed) return;
        // eslint-disable-next-line no-new
        this.worker = new Worker(safeWorkerPath(), { type: "module" });
        this.worker.onmessage = (e: MessageEvent<any>) => {
            const msg = e.data;
            if (!msg?.requestId) return;
            const p = this.pending.get(msg.requestId);
            if (!p) return;
            this.pending.delete(msg.requestId);

            if (msg.type === "SEARCH_ERROR") p.reject(msg);
            else p.resolve(msg);
        };
        this.worker.onerror = (e) => {
            console.error("[EventSearchClient] Worker error:", e.message);
        };
    }

    private request<TReq extends { requestId: string }, TRes>(msg: TReq): Promise<TRes> {
        this.ensureWorker();
        const requestId = msg.requestId;
        return new Promise((resolve, reject) => {
            if (!this.worker) return reject(new Error("Worker not initialized"));
            this.pending.set(requestId, { resolve: resolve as any, reject });
            this.worker.postMessage(msg);
        });
    }

    /**
     * Builds an inverted index inside the worker.
     * Caller should pass the current translated dataset.
     */
    async buildIndex(events: TranslatedEvent[], eventsHash: string): Promise<void> {
        if (this.builtForEventsHash === eventsHash) return;
        const requestId = `build_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const msg: BuildIndexRequest = {
            type: "BUILD_INDEX",
            requestId,
            events,
        };

        const res = await this.request<BuildIndexRequest, BuildIndexResponse>(msg);
        if (!res?.ok) throw new Error("Failed to build index");
        this.builtForEventsHash = eventsHash;
    }

    /**
     * Incrementally add new events to the existing index.
     * No full rebuild needed — new events are appended to the index.
     */
    async addEvents(events: TranslatedEvent[]): Promise<number> {
        if (events.length === 0) return 0;
        const requestId = `add_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const msg: AddEventsRequest = {
            type: "ADD_EVENTS",
            requestId,
            events,
        };

        const res = await this.request<AddEventsRequest, AddEventsResponse>(msg);
        return res.totalCount;
    }

    /**
     * Remove events from the index by their IDs.
     */
    async removeEvents(eventIds: string[]): Promise<number> {
        if (eventIds.length === 0) return 0;
        const requestId = `remove_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const msg: RemoveEventsRequest = {
            type: "REMOVE_EVENTS",
            requestId,
            eventIds,
        };

        const res = await this.request<RemoveEventsRequest, RemoveEventsResponse>(msg);
        return res.totalCount;
    }

    async search(query: string, opts: { contractId?: string; limit?: number } = {}): Promise<SearchResponse["hits"]> {
        const requestId = `search_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const msg: SearchRequest = {
            type: "SEARCH",
            requestId,
            query,
            contractId: opts.contractId,
            limit: opts.limit,
        };

        const res = await this.request<SearchRequest, SearchResponse | SearchError>(msg);
        if ((res as any).type === "SEARCH_ERROR") {
            throw new Error((res as SearchError).error);
        }
        return (res as SearchResponse).hits;
    }

    destroy() {
        this.destroyed = true;
        this.worker?.terminate();
        this.worker = null;
        this.pending.clear();
        this.builtForEventsHash = null;
    }
}

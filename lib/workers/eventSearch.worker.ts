/**
 * In-browser event search worker
 *
 * Builds a lightweight inverted index over event text fields so the UI
 * never blocks on large-array traversal.
 */

import type { TranslatedEvent } from "../translator/types";


export type SearchToken = string;

export interface BuildIndexRequest {
    type: "BUILD_INDEX";
    requestId: string;
    events: TranslatedEvent[];
}

export interface BuildIndexResponse {
    type: "BUILD_INDEX_RESULT";
    requestId: string;
    ok: true;
}

export interface SearchRequest {
    type: "SEARCH";
    requestId: string;
    query: string;
    /** Inclusive contract filter. When absent, searches across all contracts. */
    contractId?: string;
    /** Max results to return. */
    limit?: number;
}

export interface SearchResponse {
    type: "SEARCH_RESULT";
    requestId: string;
    hits: Array<{ id: string; score: number }>;
}

export interface SearchError {
    type: "SEARCH_ERROR";
    requestId: string;
    error: string;
}

type WorkerMessage = BuildIndexRequest | SearchRequest;

type IndexedEvent = {
    id: string;
    contractId: string;
    // precomputed concatenated text for fallback verification
    text: string;
};

// token -> docIds
// Use plain number[] postings to keep this worker implementation
// environment-agnostic (no strict Int32Array typing issues).
type InvertedIndex = Map<SearchToken, number[]>;


const STOP_WORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "is",
    "are",
    "be",
    "as",
    "at",
    "by",
    "from",
    "that",
    "this",
    "it",
    "your",
    "you",
    "i",
    "we",
    "they",
    "them",
    "was",
    "were",
    "will",
    "can",
    "could",
    "should",
    "would",
    "may",
    "might",
    "not",
]);

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFKD")
        // remove diacritics
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function tokenize(s: string): string[] {
    const norm = normalize(s);
    if (!norm) return [];
    const raw = norm.split(/\s+/g);
    const tokens: string[] = [];
    for (const t of raw) {
        if (t.length < 2) continue;
        if (STOP_WORDS.has(t)) continue;
        tokens.push(t);
    }
    return tokens;
}

// Support basic boolean operators:
//  - space-separated terms => AND
//  - OR keyword => OR groups
//  - NOT prefix on term => exclude
// This is intentionally lightweight.
function parseQuery(query: string): {
    orGroups: Array<{ must: string[]; not: string[] }>;
    rawTokens: string[];
} {
    const norm = normalize(query);
    const parts = norm.split(" OR ");

    const orGroups = parts.map((p) => {
        const tokens = p.split(/\s+/g).filter(Boolean);
        const must: string[] = [];
        const not: string[] = [];
        for (const t of tokens) {
            if (!t) continue;
            if (t.startsWith("not:")) {
                const term = t.slice(4).trim();
                if (term) not.push(term);
                continue;
            }
            if (t.startsWith("!")) {
                const term = t.slice(1).trim();
                if (term) not.push(term);
                continue;
            }
            must.push(t);
        }
        return { must, not };
    });

    return { orGroups, rawTokens: tokenize(norm) };
}

let index: InvertedIndex = new Map();
let docs: IndexedEvent[] = [];
let docsById = new Map<string, number>();
let builtContractIds: Int32Array | null = null;
let contractIdToDocIds: Map<string, number[]> = new Map();
let built = false;

function ensureIndexForSearch() {
    if (!built) {
        // eslint-disable-next-line no-throw-literal
        throw new Error("Index not built");
    }
}

function addToken(token: string, docIndex: number) {
    const existing = index.get(token);
    if (!existing) {
        index.set(token, [docIndex]);
        return;
    }
    (existing as number[]).push(docIndex);
}

function buildIndex(events: TranslatedEvent[]) {
    index = new Map();
    docs = new Array(events.length);
    docsById = new Map();
    contractIdToDocIds = new Map();

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const id = ev.raw.id;
        const contractId = ev.raw.contractId;

        const description = ev.description ?? "";
        const eventType = ev.eventType ?? "";

        // Include raw topic hints as well.
        const topicText = Array.isArray(ev.raw.topics) ? ev.raw.topics.join(" ") : "";
        const ledgerText = String(ev.raw.ledger ?? "");

        const text = `${id} ${contractId} ${eventType} ${description} ${topicText} ${ledgerText}`;

        docs[i] = { id, contractId, text };
        docsById.set(id, i);

        const list = contractIdToDocIds.get(contractId);
        if (list) list.push(i);
        else contractIdToDocIds.set(contractId, [i]);

        const tokens = tokenize(text);
        for (const token of tokens) addToken(token, i);
    }

    // Sort and de-dupe token postings lists.
    for (const [token, posting] of index.entries()) {
        const arr = posting as number[];
        arr.sort((a, b) => a - b);
        let w = 0;
        for (let r = 0; r < arr.length; r++) {
            if (r === 0 || arr[r] !== arr[w - 1]) {
                arr[w++] = arr[r];
            }
        }
        arr.length = w;
        index.set(token, arr);
    }

    built = true;
}

function postingsFor(token: string, contractId?: string): number[] {
    const base = index.get(token) as number[] | undefined;
    if (!base) return [];
    if (!contractId) return base;

    const allowed = contractIdToDocIds.get(contractId);
    if (!allowed) return [];

    // Intersection of sorted arrays
    const allowedSet = new Set(allowed);
    const out: number[] = [];
    for (const docId of base) if (allowedSet.has(docId)) out.push(docId);
    return out;
}

function scoreDocuments(query: string, contractId?: string, limit: number = 50) {
    ensureIndexForSearch();

    const { orGroups } = parseQuery(query);
    const scores = new Map<number, number>();

    for (const group of orGroups) {
        if (group.must.length === 0) continue;

        // Start from postings of first must term
        let candidate: number[] | null = null;

        for (let m = 0; m < group.must.length; m++) {
            const term = group.must[m];
            const post = postingsFor(term, contractId);
            if (post.length === 0) {
                candidate = [];
                break;
            }

            if (candidate === null) {
                candidate = post.slice();
            } else {
                // intersect candidate with post (sorted arrays)
                const a = candidate;
                const b = post;
                const inter: number[] = [];
                let i = 0;
                let j = 0;
                while (i < a.length && j < b.length) {
                    if (a[i] === b[j]) {
                        inter.push(a[i]);
                        i++;
                        j++;
                    } else if (a[i] < b[j]) {
                        i++;
                    } else {
                        j++;
                    }
                }
                candidate = inter;
                if (candidate.length === 0) break;
            }
        }

        if (!candidate || candidate.length === 0) continue;

        // Apply NOT filters by removing matches
        if (group.not.length) {
            const notSet = new Set<number>();
            for (const nt of group.not) {
                for (const docIdx of postingsFor(nt, contractId)) notSet.add(docIdx);
            }
            candidate = candidate.filter((docIdx) => !notSet.has(docIdx));
            if (candidate.length === 0) continue;
        }

        // Score candidates: simple term frequency weighting.
        for (const docIdx of candidate) {
            const text = docs[docIdx].text;
            let s = scores.get(docIdx) ?? 0;

            for (const term of group.must) {
                if (term && text.includes(term)) s += 2;
            }
            // boost exact contractId hits when query includes C...
            if (contractId && text.includes(contractId)) s += 1;

            scores.set(docIdx, s);
        }
    }

    // If query doesn't include must terms or got zero candidates, do fallback substring
    if (scores.size === 0) {
        const normQuery = normalize(query);
        if (!normQuery) return [];

        const candidates = contractId ? contractIdToDocIds.get(contractId) ?? [] : docs.map((_, i) => i);
        const hits: Array<{ id: string; score: number }> = [];
        for (const docIdx of candidates) {
            const text = docs[docIdx].text;
            if (text.includes(normQuery)) {
                const score = 1 + Math.min(20, normQuery.length);
                hits.push({ id: docs[docIdx].id, score });
            }
        }

        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, limit);
    }

    const hits = Array.from(scores.entries())
        .map(([docIdx, score]) => ({ id: docs[docIdx].id, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return hits;
}

self.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const msg = ev.data;
    if (!msg) return;

    try {
        if (msg.type === "BUILD_INDEX") {
            buildIndex(msg.events);
            const res: BuildIndexResponse = {
                type: "BUILD_INDEX_RESULT",
                requestId: msg.requestId,
                ok: true,
            };
            self.postMessage(res);

            return;

        }

        if (msg.type === "SEARCH") {
            const hits = scoreDocuments(msg.query, msg.contractId, msg.limit ?? 50);
            const res: SearchResponse = {
                type: "SEARCH_RESULT",
                requestId: msg.requestId,
                hits,
            };
            self.postMessage(res);
            return;

        }
    } catch (err) {
        const res: SearchError = {
            type: "SEARCH_ERROR",
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(res);

    }
};


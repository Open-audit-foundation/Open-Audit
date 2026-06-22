"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import type { TranslatedEvent } from "../translator/types";

export interface GraphNode {
  id: string;
  /** Shortened display label. */
  label: string;
  /** "contract" | "address" */
  kind: "contract" | "address";
  /** Number of events involving this node (drives node size). */
  val: number;
  /** Cached event history for the detail panel. */
  events: TranslatedEvent[];
}

export interface GraphLink {
  source: string;
  target: string;
  /** Human-readable event description for tooltip. */
  label: string;
  eventType: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface FilterState {
  eventType: string;
  minInteractions: number;
}

function shorten(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function isContract(id: string): boolean {
  // Soroban contract addresses start with 'C'; account addresses start with 'G'
  return id.startsWith("C");
}

/**
 * Builds and incrementally updates a ForceGraph3D-compatible graph dataset
 * from a stream of TranslatedEvents.
 *
 * Each event creates:
 *   - a "contract" node for event.raw.contractId
 *   - an "address" node for any address found in topics[1] and topics[2]
 *   - a directed link: from → contract (or from → to for transfers)
 *
 * The hook caps nodes at MAX_NODES to keep the renderer performant.
 */
export function useGraphData(filter: FilterState) {
  const MAX_NODES = 500;

  // Use a ref-backed map so addEvent doesn't recreate the entire graph on
  // every call; we only call setState once per batch.
  const nodesMap = useRef<Map<string, GraphNode>>(new Map());
  const linksArr = useRef<GraphLink[]>([]);

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  const addEvents = useCallback((events: TranslatedEvent[]) => {
    let dirty = false;

    for (const event of events) {
      const { raw, description, eventType } = event;
      const contractId = raw.contractId;

      // Contract node
      if (!nodesMap.current.has(contractId)) {
        if (nodesMap.current.size >= MAX_NODES) continue;
        nodesMap.current.set(contractId, {
          id: contractId,
          label: shorten(contractId),
          kind: "contract",
          val: 1,
          events: [event],
        });
        dirty = true;
      } else {
        const n = nodesMap.current.get(contractId)!;
        n.val += 1;
        n.events = [event, ...n.events].slice(0, 50);
        dirty = true;
      }

      // Address nodes (topics[1] = from, topics[2] = to for SAC-style events)
      const addresses = raw.topics.slice(1, 3).filter(Boolean);
      for (const addr of addresses) {
        if (addr.length < 10) continue;
        if (!nodesMap.current.has(addr)) {
          if (nodesMap.current.size >= MAX_NODES) continue;
          nodesMap.current.set(addr, {
            id: addr,
            label: shorten(addr),
            kind: isContract(addr) ? "contract" : "address",
            val: 1,
            events: [event],
          });
          dirty = true;
        } else {
          const n = nodesMap.current.get(addr)!;
          n.val += 1;
          n.events = [event, ...n.events].slice(0, 50);
          dirty = true;
        }
      }

      // Link: from-address → contract (or addresses[0] → addresses[1])
      const src = addresses[0] ?? contractId;
      const tgt = addresses[1] ?? contractId;
      if (src !== tgt && nodesMap.current.has(src) && nodesMap.current.has(tgt)) {
        linksArr.current.push({
          source: src,
          target: tgt,
          label: description ?? raw.txHash.slice(0, 16),
          eventType,
        });
        dirty = true;
      }
    }

    if (dirty) {
      setGraphData({
        nodes: Array.from(nodesMap.current.values()),
        links: linksArr.current.slice(-2000), // keep last 2 000 links
      });
    }
  }, []);

  const reset = useCallback(() => {
    nodesMap.current.clear();
    linksArr.current = [];
    setGraphData({ nodes: [], links: [] });
  }, []);

  /** Apply filter — derived, no extra state. */
  const filtered = useMemo<GraphData>(() => {
    const { eventType, minInteractions } = filter;
    const nodes = graphData.nodes.filter((n) => n.val >= minInteractions);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = graphData.links.filter(
      (l) =>
        nodeIds.has(l.source as string) &&
        nodeIds.has(l.target as string) &&
        (eventType === "" || l.eventType === eventType),
    );
    return { nodes, links };
  }, [graphData, filter]);

  /** Unique event types for the filter dropdown. */
  const eventTypes = useMemo(
    () => [...new Set(graphData.links.map((l) => l.eventType).filter(Boolean))] as string[],
    [graphData.links],
  );

  return { graphData: filtered, addEvents, reset, eventTypes };
}

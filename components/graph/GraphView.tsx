"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveFeed } from "@/lib/hooks/useLiveFeed";
import { useGraphData, type GraphNode, type FilterState } from "@/lib/hooks/useGraphData";
import type { TranslatedEvent } from "@/lib/translator/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";
import { translateEvents } from "@/lib/translator/registry";

// ForceGraph3D requires browser APIs — load client-side only.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

// ── Node colour mapping ────────────────────────────────────────────────────
const NODE_COLORS: Record<string, string> = {
  contract: "#7c3aed",
  address: "#0ea5e9",
};

const LINK_COLORS: Record<string, string> = {
  transfer: "#22c55e",
  mint: "#f59e0b",
  burn: "#ef4444",
  default: "#64748b",
};

function linkColor(eventType: string | null): string {
  if (!eventType) return LINK_COLORS.default;
  const key = eventType.toLowerCase();
  return LINK_COLORS[key] ?? LINK_COLORS.default;
}

// ── Node detail panel ──────────────────────────────────────────────────────
function NodeDetail({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  return (
    <aside className="absolute top-4 right-4 z-10 w-80 rounded-lg border bg-background/95 shadow-lg backdrop-blur p-4 space-y-3 overflow-y-auto max-h-[80vh]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{node.kind}</p>
          <p className="font-mono text-sm break-all">{node.id}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close detail panel">
          ✕
        </Button>
      </div>
      <div className="flex gap-2">
        <Badge variant="secondary">{node.val} interactions</Badge>
        <Badge
          style={{ backgroundColor: NODE_COLORS[node.kind], color: "#fff", border: "none" }}
        >
          {node.kind}
        </Badge>
      </div>
      <h3 className="text-sm font-semibold">Recent events</h3>
      <ul className="space-y-2">
        {node.events.slice(0, 20).map((e) => (
          <li key={e.raw.id} className="text-xs border rounded p-2 space-y-1">
            <div className="flex items-center justify-between gap-1">
              {e.eventType && <Badge variant="outline" className="text-[10px]">{e.eventType}</Badge>}
              <span className="text-muted-foreground ml-auto">
                {new Date(e.raw.timestamp * 1000).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-muted-foreground break-words">
              {e.description ?? "Untranslated event"}
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────
function FilterBar({
  eventTypes,
  filter,
  setFilter,
  isLive,
  onToggleLive,
  onReset,
  nodeCount,
  linkCount,
}: {
  eventTypes: string[];
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  isLive: boolean;
  onToggleLive: () => void;
  onReset: () => void;
  nodeCount: number;
  linkCount: number;
}) {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 shadow-sm backdrop-blur p-3 max-w-lg">
      {/* Live toggle */}
      <Button
        size="sm"
        variant={isLive ? "default" : "outline"}
        onClick={onToggleLive}
        className="gap-1"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${isLive ? "bg-green-400 animate-pulse" : "bg-gray-400"}`}
        />
        {isLive ? "Live" : "Connect"}
      </Button>

      {/* Event-type filter */}
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={filter.eventType}
        onChange={(e) => setFilter({ ...filter, eventType: e.target.value })}
        aria-label="Filter by event type"
      >
        <option value="">All types</option>
        {eventTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* Min-interactions slider */}
      <label className="flex items-center gap-1 text-sm">
        Min&nbsp;interactions
        <input
          type="range"
          min={1}
          max={20}
          value={filter.minInteractions}
          onChange={(e) =>
            setFilter({ ...filter, minInteractions: Number(e.target.value) })
          }
          className="w-20"
          aria-label="Minimum interactions"
        />
        <span className="w-4 text-center">{filter.minInteractions}</span>
      </label>

      {/* Stats */}
      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
        {nodeCount} nodes · {linkCount} links
      </span>

      {/* Reset */}
      <Button size="sm" variant="ghost" onClick={onReset}>
        Reset
      </Button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function GraphView() {
  const [filter, setFilter] = useState<FilterState>({ eventType: "", minInteractions: 1 });
  const { graphData, addEvents, reset, eventTypes } = useGraphData(filter);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Seed with mock data on mount so the graph isn't empty before WebSocket connects.
  useEffect(() => {
    const initial = translateEvents(MOCK_RAW_EVENTS, "en");
    addEvents(initial);
  }, [addEvents]);

  const handleLiveEvent = useCallback(
    (event: TranslatedEvent) => addEvents([event]),
    [addEvents],
  );

  const { isLive, toggleLive } = useLiveFeed(handleLiveEvent);

  const handleReset = useCallback(() => {
    reset();
    setSelectedNode(null);
  }, [reset]);

  // ForceGraph3D measures its container; give it a stable full-viewport ref.
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(el);
    setDims({ width: el.clientWidth, height: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full" aria-label="3D ecosystem graph">
      {dims.width > 0 && (
        <ForceGraph3D
          width={dims.width}
          height={dims.height}
          graphData={graphData}
          nodeLabel={(n) => (n as GraphNode).label}
          nodeColor={(n) => NODE_COLORS[(n as GraphNode).kind] ?? "#888"}
          nodeVal={(n) => (n as GraphNode).val}
          linkColor={(l) => linkColor((l as { eventType: string | null }).eventType)}
          linkWidth={1}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={1.5}
          onNodeClick={(node) => setSelectedNode(node as GraphNode)}
          backgroundColor="#0f0f10"
        />
      )}

      <FilterBar
        eventTypes={eventTypes}
        filter={filter}
        setFilter={setFilter}
        isLive={isLive}
        onToggleLive={toggleLive}
        onReset={handleReset}
        nodeCount={graphData.nodes.length}
        linkCount={graphData.links.length}
      />

      {selectedNode && (
        <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}

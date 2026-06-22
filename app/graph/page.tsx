import type { Metadata } from "next";
import { GraphView } from "@/components/graph/GraphView";

export const metadata: Metadata = {
  title: "Ecosystem Graph — Open-Audit",
  description:
    "WebGL-accelerated 3D visualization of Soroban contract interactions. " +
    "Nodes represent addresses and contracts; edges represent translated events.",
};

export default function GraphPage() {
  return (
    <main className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-4 py-3 border-b">
        <h1 className="text-xl font-semibold tracking-tight">Ecosystem Graph</h1>
        <p className="text-sm text-muted-foreground">
          Live 3D visualization of contract interactions · Click a node to see its event history
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <GraphView />
      </div>
    </main>
  );
}

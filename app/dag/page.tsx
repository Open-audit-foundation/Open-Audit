import type { Metadata } from "next";
import { DagExplorer } from "@/components/dag/DagExplorer";

export const metadata: Metadata = {
  title: "Execution Call Tree — Open-Audit",
  description:
    "Inspect Soroban transaction execution trees. Visualise cross-contract " +
    "calls with accurate per-frame gas attribution.",
};

export default function DagPage() {
  return (
    <main className="flex flex-col min-h-[calc(100vh-4rem)]">
      <div className="px-4 py-3 border-b">
        <h1 className="text-xl font-semibold tracking-tight">Execution Call Tree</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Soroban transaction hash to reconstruct its cross-contract call
          tree with per-frame gas attribution.
        </p>
      </div>
      <div className="flex-1 container mx-auto max-w-4xl px-4 py-6">
        <DagExplorer />
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { Network } from "lucide-react";

export const metadata: Metadata = {
  title: "Transaction Graph",
  description:
    "Visualize Stellar transaction relationships and token flows as an interactive graph. Coming soon.",
};

export default function GraphPage(): React.JSX.Element {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page header */}
      <div className="mb-12 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 mb-6">
          <Network className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">Transaction Graph</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Explore Stellar transaction relationships, token flows, and contract interactions as an
          interactive network visualization. Trace the path of assets across contracts and accounts.
        </p>
      </div>

      {/* Coming Soon card */}
      <div className="bg-card border rounded-xl p-8 md:p-12 text-center">
        <div className="inline-flex items-center gap-2 text-violet-600 dark:text-violet-400 mb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
          </span>
          <span className="font-medium">Under Active Development</span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Coming Soon</h2>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          The Transaction Graph visualization is currently being built. This feature will allow you
          to:
        </p>
        <ul className="text-left max-w-md mx-auto space-y-3 text-muted-foreground">
          <li className="flex items-center gap-2">
            <Network className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Visualize transaction networks and token flows between contracts</span>
          </li>
          <li className="flex items-center gap-2">
            <Network className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Filter by asset type, time range, and contract interactions</span>
          </li>
          <li className="flex items-center gap-2">
            <Network className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Drill down into individual transactions and contract calls</span>
          </li>
          <li className="flex items-center gap-2">
            <Network className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Export graph data for further analysis</span>
          </li>
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          Check back soon for updates. Follow our{" "}
          <a
            href="https://github.com/your-org/open-audit"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            GitHub repository
          </a>{" "}
          for development progress.
        </p>
      </div>
    </main>
  );
}
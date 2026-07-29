import type { Metadata } from "next";
import { GitBranch } from "lucide-react";

export const metadata: Metadata = {
  title: "Call Tree (DAG)",
  description:
    "Visualize Soroban contract call trees as a directed acyclic graph. Trace nested contract calls and execution flows. Coming soon.",
};

export default function DagPage(): React.JSX.Element {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page header */}
      <div className="mb-12 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 mb-6">
          <GitBranch className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">Call Tree (DAG)</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Visualize Soroban contract execution as a directed acyclic graph. Trace nested contract
          calls, authorization flows, and execution dependencies in a clear hierarchical view.
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
          The Call Tree (DAG) visualization is currently being built. This feature will allow you
          to:
        </p>
        <ul className="text-left max-w-md mx-auto space-y-3 text-muted-foreground">
          <li className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-500 shrink-0" />
            <span>View nested contract calls as a hierarchical tree structure</span>
          </li>
          <li className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Trace authorization and require_auth chains across contracts</span>
          </li>
          <li className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Identify reentrancy patterns and execution dependencies</span>
          </li>
          <li className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-500 shrink-0" />
            <span>Filter by contract, function, and call depth</span>
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
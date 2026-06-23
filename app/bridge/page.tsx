import { Suspense } from "react";
import type { Metadata } from "next";
import { BridgeClient } from "./BridgeClient";

export const metadata: Metadata = {
  title: "Cross-Chain Bridge Tracker — Open-Audit",
  description:
    "Track assets moving between Stellar/Soroban and Ethereum (or L2s) via bridges. " +
    "Pairs Burn events from Soroban with Mint events on EVM chains in real time.",
};

export default function BridgePage(): React.JSX.Element {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cross-Chain Bridge Tracker
        </h1>
        <p className="text-muted-foreground mt-1">
          Follows assets as they cross from Stellar/Soroban to Ethereum and L2s.
          Each row pairs a Soroban Burn with its EVM Mint so auditors can trace
          the complete journey.
        </p>
      </div>

      <Suspense fallback={null}>
        <BridgeClient />
      </Suspense>
    </main>
  );
}

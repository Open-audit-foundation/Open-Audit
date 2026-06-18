import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard — Open-Audit",
  description:
    "Translate cryptic Soroban smart contract events into human-readable English. The Google Translate for Stellar.",
};

export default function DashboardPage(): React.JSX.Element {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Event Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Search any Soroban contract to see its events translated into plain English.
        </p>
      </div>

      {/* Suspense is required by next/navigation's useSearchParams in a
          statically-rendered route. */}
      <Suspense fallback={null}>
        <DashboardClient />
      </Suspense>
    </main>
  );
}

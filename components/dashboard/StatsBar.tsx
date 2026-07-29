import { CheckCircle2, HelpCircle, BookOpen, Zap } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { getBlueprintCount } from "@/lib/translator/registry";
import type { TranslatedEvent } from "@/lib/translator/types";

interface StatsBarProps {
  events: TranslatedEvent[];
}

interface SystemStats {
  totalEvents: number;
  translatedCount: number;
  crypticCount: number;
  translationRate: number;
  deadLetterQueueSize: number;
  lastIndexedLedger: number | null;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
}

function StatCard({ icon, label, value, sublabel }: StatCardProps): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3" role="figure" aria-label={`${label}: ${value}`}>
        <div className="flex-shrink-0 text-muted-foreground" aria-hidden="true">{icon}</div>
        <div>
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
          {sublabel && <p className="text-xs text-muted-foreground/60">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonStatCard(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-5 w-5 rounded bg-muted animate-pulse flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-7 w-10 bg-muted animate-pulse rounded" />
          <div className="h-3 w-24 bg-muted animate-pulse rounded" />
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        </div>
      </CardContent>
    </Card>
  );
}

function LocalStatCard({ icon, label, value, sublabel }: StatCardProps): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="p-3 flex items-center gap-2" role="figure" aria-label={`${label}: ${value}`}>
        <div className="flex-shrink-0 text-muted-foreground" aria-hidden="true">{icon}</div>
        <div>
          <p className="text-lg font-semibold leading-none">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
          {sublabel && <p className="text-[11px] text-muted-foreground/60">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsBar({ events }: StatsBarProps): React.JSX.Element {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);

  const { translated, cryptic, translationRate, blueprintCount } = useMemo(
    function () {
      const translated = events.filter(function (e) {
        return e.status === "translated";
      }).length;

      const cryptic = events.filter(function (e) {
        return e.status === "cryptic";
      }).length;

      const translationRate =
        events.length > 0 ? Math.round((translated / events.length) * 100) : 0;

      const blueprintCount = getBlueprintCount();

      return { translated, cryptic, translationRate, blueprintCount };
    },
    [events]
  );

  useEffect(function () {
    let timer: NodeJS.Timeout;

    async function fetchStats(): Promise<void> {
      try {
        const res = await fetch("/api/v1/stats");
        if (res.ok) {
          const data = (await res.json()) as SystemStats;
          setSystemStats(data);
        }
      } catch {
        // Silently ignore fetch errors; next poll will retry.
      } finally {
        setSystemLoading(false);
      }
    }

    fetchStats();
    timer = setInterval(fetchStats, 30000);

    return function () {
      clearInterval(timer);
    };
  }, []);

  const viewTotal = events.length;

  if (systemLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map(function (_, i) {
            return <SkeletonStatCard key={i} />;
          })}
        </div>
        <p className="text-xs text-muted-foreground">Loading system-wide coverage metrics…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Zap className="h-5 w-5" />}
          label="Total Events"
          value={systemStats?.totalEvents ?? 0}
          sublabel="indexed from network"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          label="Translated"
          value={systemStats?.translatedCount ?? 0}
          sublabel={`${systemStats?.translationRate ?? 0}% translation rate`}
        />
        <StatCard
          icon={<HelpCircle className="h-5 w-5 text-amber-500" />}
          label="Cryptic"
          value={systemStats?.crypticCount ?? 0}
          sublabel="awaiting blueprints"
        />
        <StatCard
          icon={<BookOpen className="h-5 w-5 text-violet-500" />}
          label="Blueprints"
          value={blueprintCount}
          sublabel="registered contracts"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          Current view
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <LocalStatCard
          icon={<Zap className="h-4 w-4" />}
          label="View Total"
          value={viewTotal}
          sublabel="in current view"
        />
        <LocalStatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="View Translated"
          value={translated}
          sublabel={`${translationRate}% success rate`}
        />
        <LocalStatCard
          icon={<HelpCircle className="h-4 w-4 text-amber-500" />}
          label="View Cryptic"
          value={cryptic}
          sublabel="need blueprints"
        />
      </div>
    </div>
  );
}

import { CheckCircle2, HelpCircle, BookOpen, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getBlueprintCount } from "@/lib/translator/registry";
import type { TranslatedEvent } from "@/lib/translator/types";

interface StatsBarProps {
  events: TranslatedEvent[];
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
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-shrink-0 text-muted-foreground" aria-hidden="true">{icon}</div>
        <dl>
          <dd className="text-2xl font-semibold leading-none">{value}</dd>
          <dt className="text-xs text-muted-foreground mt-1">{label}</dt>
          {sublabel && <dd className="text-xs text-muted-foreground/60">{sublabel}</dd>}
        </dl>
      </CardContent>
    </Card>
  );
}

export function StatsBar({ events }: StatsBarProps): React.JSX.Element {
  const translated = events.filter(function (e) {
    return e.status === "translated";
  }).length;

  const cryptic = events.filter(function (e) {
    return e.status === "cryptic";
  }).length;

  const translationRate =
    events.length > 0 ? Math.round((translated / events.length) * 100) : 0;

  const blueprintCount = getBlueprintCount();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="region" aria-label="Event statistics">
      <StatCard
        icon={<Zap className="h-5 w-5" />}
        label="Total Events"
        value={events.length}
        sublabel="in current view"
      />
      <StatCard
        icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
        label="Translated"
        value={translated}
        sublabel={`${translationRate}% success rate`}
      />
      <StatCard
        icon={<HelpCircle className="h-5 w-5 text-amber-500" />}
        label="Cryptic"
        value={cryptic}
        sublabel="need blueprints"
      />
      <StatCard
        icon={<BookOpen className="h-5 w-5 text-violet-500" />}
        label="Blueprints"
        value={blueprintCount}
        sublabel="registered contracts"
      />
    </div>
  );
}

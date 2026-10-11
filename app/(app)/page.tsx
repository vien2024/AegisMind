import { DashboardLive } from "@/components/dashboard/dashboard-live";
import { isLiveConfigured } from "@/lib/llm";
import { buildOverview } from "@/lib/overview";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const overview = buildOverview();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const totals = repo.usageTotals();

  return (
    <DashboardLive
      initial={overview}
      live={isLiveConfigured()}
      usageInitial={{
        range: "month",
        model: null,
        totals: {
          ...totals,
          cacheHitRate: totals.total > 0 ? Math.round((totals.cacheRead / totals.total) * 100) : 0,
        },
        byModel: repo.usageByModel(),
        series: repo.usageSeries(since, "month"),
      }}
    />
  );
}

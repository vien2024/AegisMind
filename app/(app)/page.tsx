import { DashboardLive } from "@/components/dashboard/dashboard-live";
import { buildOverview } from "@/lib/overview";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const [overview, byModel, series] = await Promise.all([
    buildOverview(),
    repo.usageByModel(),
    repo.usageSeries(since, "month"),
  ]);
  const totals = overview.usage;

  return (
    <DashboardLive
      initial={overview}
      usageInitial={{
        range: "month",
        model: null,
        totals: {
          ...totals,
          cacheHitRate: totals.total > 0 ? Math.round((totals.cacheRead / totals.total) * 100) : 0,
        },
        byModel,
        series,
      }}
    />
  );
}

import { DashboardLive } from "@/components/dashboard/dashboard-live";
import { buildOverview } from "@/lib/overview";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const overview = await buildOverview();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const totals = await repo.usageTotals();

  return (
    <DashboardLive
      initial={overview}
      live={(Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(process.env.OPENROUTER_API_KEY) || Boolean(process.env.ORCAROUTER_API_KEY))}
      usageInitial={{
        range: "month",
        model: null,
        totals: {
          ...totals,
          cacheHitRate: totals.total > 0 ? Math.round((totals.cacheRead / totals.total) * 100) : 0,
        },
        byModel: await repo.usageByModel(),
        series: await repo.usageSeries(since, "month"),
      }}
    />
  );
}

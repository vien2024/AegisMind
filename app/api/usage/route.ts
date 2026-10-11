import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

const RANGES: Record<string, { days: number; bucket: "day" | "month" }> = {
  "7d": { days: 7, bucket: "day" },
  "30d": { days: 30, bucket: "day" },
  "3m": { days: 90, bucket: "month" },
  "6m": { days: 182, bucket: "month" },
  "1y": { days: 365, bucket: "month" },
};

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const url = new URL(request.url);
  const range = RANGES[url.searchParams.get("range") ?? "3m"] ?? RANGES["3m"]!;
  const since = new Date(Date.now() - range.days * 24 * 60 * 60 * 1000).toISOString();

  const model = url.searchParams.get("model") ?? undefined;
  const totals = repo.usageTotals(model);
  return Response.json({
    range: range.bucket,
    since,
    totals: {
      ...totals,
      cacheHitRate: totals.total > 0 ? Math.round((totals.cacheRead / totals.total) * 100) : 0,
    },
    byModel: repo.usageByModel(),
    series: repo.usageSeries(since, range.bucket, model),
    model: model ?? null,
  });
}

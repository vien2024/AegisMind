import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import { ASSET_KINDS, type AssetKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const kindParam = url.searchParams.get("kind");
  const search = url.searchParams.get("search") ?? undefined;
  const kind = ASSET_KINDS.includes(kindParam as AssetKind) ? (kindParam as AssetKind) : undefined;

  const assets = await repo.listAssets({
    companyId: companyId ? Number(companyId) : undefined,
    kind,
    search,
  });
  const companies = await repo.listCompanies();
  const counts: Record<string, number> = {};
  for (const asset of assets) {
    counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
  }
  return Response.json({
    assets: assets.slice(0, 1000),
    companies,
    counts,
  });
}

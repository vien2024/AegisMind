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

  const assets = repo.listAssets({
    companyId: companyId ? Number(companyId) : undefined,
    kind,
    search,
  });
  return Response.json({
    assets: assets.slice(0, 1000),
    companies: repo.listCompanies(),
    counts: assets.reduce<Record<string, number>>((acc, asset) => {
      acc[asset.kind] = (acc[asset.kind] ?? 0) + 1;
      return acc;
    }, {}),
  });
}

import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";
import { ASSET_KINDS, type AssetKind } from "@/lib/types";
import { Badge, Card, Empty, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; search?: string; companyId?: string }>;
}) {
  await requirePageUser();
  const params = await searchParams;
  const kind = ASSET_KINDS.includes(params.kind as AssetKind) ? (params.kind as AssetKind) : undefined;
  const assets = await repo.listAssets({
    kind,
    search: params.search,
    companyId: params.companyId ? Number(params.companyId) : undefined,
  });
  const companies = await repo.listCompanies();
  const byKind = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.kind] = (acc[asset.kind] ?? 0) + 1;
    return acc;
  }, {});
  const assetsById = new Map(assets.map((a) => [a.id, a]));

  return (
    <>
      <SectionHeading
        title="Assets"
        subtitle="Global source of truth shared by every task: root_domain → subdomain → service → endpoint"
      />

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {ASSET_KINDS.map((entry) => (
          <div key={entry} className="card p-3">
            <div className="text-[11px] text-muted">{entry}</div>
            <div className="mt-1.5 text-xl font-semibold leading-none tracking-tight text-ink">
              {byKind[entry] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <Card title="Filters" icon="filter" subtitle={`${assets.length} assets match`}>
        <form className="grid gap-3 md:grid-cols-3" method="get">
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Search value</span>
            <input name="search" defaultValue={params.search ?? ""} placeholder="api.demo.example.com" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Kind</span>
            <select name="kind" defaultValue={params.kind ?? ""}>
              <option value="">All kinds</option>
              {ASSET_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Company</span>
            <select name="companyId" defaultValue={params.companyId ?? ""}>
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 md:col-span-3">
            <button className="btn btn-primary" type="submit">
              Apply
            </button>
            <a className="btn" href="/assets">
              Clear
            </a>
          </div>
        </form>
      </Card>

      <Card title="Asset graph" icon="box" padded={false}>
        {assets.length === 0 ? (
          <div className="card-body">
            <Empty>No assets match the current filters.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Value</th>
                  <th>Parent</th>
                  <th>Company</th>
                  <th>Attributes</th>
                </tr>
              </thead>
              <tbody>
                {assets.slice(0, 500).map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <Badge tone="info">{asset.kind}</Badge>
                    </td>
                    <td className="mono text-[11.5px] text-ink">{asset.value}</td>
                    <td className="mono text-[11px] text-faint">
                      {asset.parent_id ? assetsById.get(asset.parent_id)?.value ?? `#${asset.parent_id}` : "—"}
                    </td>
                    <td className="text-[11px] text-muted">
                      {companies.find((c) => c.id === asset.company_id)?.name ?? "—"}
                    </td>
                    <td className="mono text-[10.5px] text-faint">
                      {asset.attributes ? JSON.stringify(asset.attributes).slice(0, 90) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

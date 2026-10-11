import Link from "next/link";
import { Badge, Card, Empty, SectionHeading, SeverityBadge, StatusBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePageUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const tasks = query
    ? repo.listTasks().filter((task) => `${task.name} ${task.target} ${task.goal ?? ""}`.toLowerCase().includes(query))
    : [];
  const assets = query ? repo.listAssets({ search: q }).slice(0, 40) : [];
  const findings = query
    ? repo
        .listFindings()
        .filter((finding) => `${finding.title} ${finding.description ?? ""} ${finding.evidence ?? ""}`.toLowerCase().includes(query))
        .slice(0, 40)
    : [];

  const total = tasks.length + assets.length + findings.length;

  return (
    <>
      <SectionHeading title="Search" subtitle={q ? `${total} results for “${q}”` : "Search tasks, assets and findings"} />

      {!q ? (
        <Empty icon="search">Enter a query in the search box above.</Empty>
      ) : total === 0 ? (
        <Empty icon="search">Nothing matched “{q}”.</Empty>
      ) : (
        <div className="space-y-4">
          <Card title="Tasks" icon="target" subtitle={`${tasks.length} matched`} padded={false}>
            {tasks.length === 0 ? (
              <div className="card-body">
                <Empty>No matching tasks.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link className="truncate text-[12.5px] font-medium text-link hover:underline" href={`/tasks/${task.id}`}>
                        {task.name}
                      </Link>
                      <div className="mono truncate text-[11px] text-faint">{task.target}</div>
                    </div>
                    <StatusBadge status={task.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Assets" icon="box" subtitle={`${assets.length} matched`} padded={false}>
            {assets.length === 0 ? (
              <div className="card-body">
                <Empty>No matching assets.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {assets.map((asset) => (
                  <li key={asset.id} className="flex items-center gap-3 px-4 py-2">
                    <Badge tone="info">{asset.kind}</Badge>
                    <span className="mono truncate text-[11.5px] text-ink">{asset.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Findings" icon="bug" subtitle={`${findings.length} matched`} padded={false}>
            {findings.length === 0 ? (
              <div className="card-body">
                <Empty>No matching findings.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {findings.map((finding) => (
                  <li key={finding.id} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={finding.severity} className="mt-0.5 shrink-0 capitalize" />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-ink">{finding.title}</div>
                      {finding.description && <div className="truncate text-[11px] text-muted">{finding.description}</div>}
                    </div>
                    {finding.task_id && (
                      <Link className="ml-auto shrink-0 text-[11px] text-link hover:underline" href={`/tasks/${finding.task_id}`}>
                        Open task
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

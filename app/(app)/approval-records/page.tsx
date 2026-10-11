import Link from "next/link";
import { Badge, Card, Empty, SectionHeading } from "@/components/ui";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ApprovalRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePageUser();
  const params = await searchParams;
  const tasks = repo.listTasks();
  const taskName = (id: number | null) => tasks.find((task) => task.id === id)?.name ?? null;

  const all = repo.listApprovals();
  const rows = all.filter((approval) => (params.status ? approval.status === params.status : true));
  const statuses = [...new Set(all.map((approval) => approval.status))];

  return (
    <>
      <SectionHeading
        title="Approval records"
        subtitle="Decisions taken by the interception gate before any asset-touching tool ran"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total", all.length],
          ["Auto-approved", all.filter((a) => a.status === "auto_approved").length],
          ["Awaiting decision", all.filter((a) => a.status === "pending").length],
          ["Denied", all.filter((a) => a.status === "denied").length],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <div className="text-[11px] text-muted">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</div>
          </div>
        ))}
      </div>

      <Card
        title="Records"
        icon="checkCircle"
        subtitle={`${rows.length} shown`}
        action={
          <div className="flex flex-wrap gap-1.5">
            <Link className="chip" data-active={!params.status ? "true" : "false"} href="/approval-records">
              All
            </Link>
            {statuses.map((status) => (
              <Link
                key={status}
                className="chip"
                data-active={params.status === status ? "true" : "false"}
                href={`/approval-records?status=${status}`}
              >
                {status.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
        }
        padded={false}
      >
        {rows.length === 0 ? (
          <div className="card-body">
            <Empty icon="checkCircle">No approval records yet.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Arguments</th>
                  <th>Reason</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Decided</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((approval) => (
                  <tr key={approval.id}>
                    <td className="mono text-[11.5px] text-ink">{approval.tool}</td>
                    <td className="mono max-w-[300px] truncate text-[10.5px] text-muted">{approval.args}</td>
                    <td className="max-w-[220px] truncate text-[11px] text-faint">{approval.reason ?? "—"}</td>
                    <td className="text-[11px]">
                      {approval.task_id ? (
                        <Link className="text-link hover:underline" href={`/tasks/${approval.task_id}`}>
                          {taskName(approval.task_id) ?? `#${approval.task_id}`}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge tone={approval.status === "denied" ? "failed" : approval.status === "pending" ? "awaiting_approval" : "completed"}>
                        {approval.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-faint">
                      {approval.decided_at ? new Date(approval.decided_at).toLocaleString() : "—"}
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

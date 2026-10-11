import Link from "next/link";
import { Badge, Card, Empty, SectionHeading } from "@/components/ui";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ToolExecutionsPage() {
  await requirePageUser();
  const tasks = repo.listTasks();
  const taskName = (id: number | null) => tasks.find((task) => task.id === id)?.name ?? null;

  const approvals = repo.listApprovals();
  const results = tasks
    .flatMap((task) => repo.listActivity(task.id, 200))
    .filter((entry) => entry.type === "tool_result" || entry.type === "tool_use")
    .sort((a, b) => b.id - a.id)
    .slice(0, 200);

  return (
    <>
      <SectionHeading
        title="Tool executions"
        subtitle="Every gated tool call and the results the workers wrote back"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Calls recorded", approvals.length],
          ["Auto-approved", approvals.filter((a) => a.status === "auto_approved").length],
          ["Awaiting decision", approvals.filter((a) => a.status === "pending").length],
          ["Results written", results.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <div className="text-[11px] text-muted">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</div>
          </div>
        ))}
      </div>

      <Card title="Gated tool calls" icon="shield" subtitle="Recorded by the interception gate" padded={false}>
        {approvals.length === 0 ? (
          <div className="card-body">
            <Empty icon="terminal">No tool calls recorded yet.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Arguments</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {approvals.slice(0, 200).map((approval) => (
                  <tr key={approval.id}>
                    <td className="mono text-[11.5px] text-ink">{approval.tool}</td>
                    <td className="mono max-w-[380px] truncate text-[11px] text-muted">{approval.args}</td>
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
                        {approval.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-faint">
                      {new Date(approval.created_at).toLocaleTimeString()}
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

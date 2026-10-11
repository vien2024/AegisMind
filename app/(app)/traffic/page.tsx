import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";
import { Badge, Card, Empty, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string }>;
}) {
  await requirePageUser();
  const params = await searchParams;
  const taskId = params.taskId ? Number(params.taskId) : undefined;
  const traffic = repo.listTraffic(taskId, 300);
  const tasks = repo.listTasks();

  return (
    <>
      <SectionHeading
        title="Traffic"
        subtitle="Recorded exchanges from the agent tools — simulated locally in this edition"
      />

      <Card
        title="Recorded traffic"
        icon="activity"
        subtitle={`${traffic.length} records`}
        action={
          <form method="get" className="flex items-center gap-2">
            <select name="taskId" defaultValue={params.taskId ?? ""} className="w-52! py-1! text-[11px]!">
              <option value="">All tasks</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  #{task.id} {task.name}
                </option>
              ))}
            </select>
            <button className="btn px-2.5! py-1! text-[11px]!" type="submit">
              Filter
            </button>
          </form>
        }
        padded={false}
      >
        {traffic.length === 0 ? (
          <div className="card-body">
            <Empty>No traffic recorded yet.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Intent</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {traffic.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Badge tone="info">{record.method}</Badge>
                    </td>
                    <td className="mono text-[11.5px] text-ink">{record.url}</td>
                    <td className="text-[12px]">{record.status ?? "—"}</td>
                    <td className="text-[11px] text-faint">{record.intent_id ? `#${record.intent_id}` : "—"}</td>
                    <td className="whitespace-nowrap text-[11px] text-faint">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {traffic[0] && (
        <Card title="Latest exchange" icon="gitBranch" subtitle="Full request and response of the most recent record">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Request", traffic[0].request],
              ["Response", traffic[0].response],
            ].map(([label, body]) => (
              <div key={label}>
                <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{label}</div>
                <pre className="mono scroll max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-subtle p-2 text-[11px] text-muted">
                  {body ?? "(none)"}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

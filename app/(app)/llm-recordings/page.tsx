import Link from "next/link";
import { Badge, Card, Empty, SectionHeading } from "@/components/ui";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export default async function LlmRecordingsPage() {
  await requirePageUser();
  const tasks = repo.listTasks();
  const rows = repo.listUsage(300);
  const totals = repo.usageTotals();

  return (
    <>
      <SectionHeading
        title="LLM recordings"
        subtitle="One record per agent turn, including the tokens the AI SDK reported"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total tokens", compact(totals.total)],
          ["Input", compact(totals.input)],
          ["Output", compact(totals.output)],
          ["Cache read", compact(totals.cacheRead)],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <div className="text-[11px] text-muted">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</div>
          </div>
        ))}
      </div>

      <Card title="Agent turns" icon="audioLines" subtitle={`${rows.length} most recent`} padded={false}>
        {rows.length === 0 ? (
          <div className="card-body">
            <Empty icon="audioLines">No agent turns recorded yet — start a task.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache</th>
                  <th>Mode</th>
                  <th>Task</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono text-[11.5px] text-ink">{row.role}</td>
                    <td className="mono text-[11px] text-muted">{row.model}</td>
                    <td className="text-[11px] text-muted">{row.provider}</td>
                    <td className="text-[12px]">{row.input_tokens.toLocaleString()}</td>
                    <td className="text-[12px]">{row.output_tokens.toLocaleString()}</td>
                    <td className="text-[12px]">{row.cache_read_tokens.toLocaleString()}</td>
                    <td>
                      <Badge tone={row.live ? "completed" : "neutral"}>{row.live ? "live" : "simulated"}</Badge>
                    </td>
                    <td className="text-[11px]">
                      {row.task_id ? (
                        <Link className="text-link hover:underline" href={`/tasks/${row.task_id}`}>
                          {tasks.find((task) => task.id === row.task_id)?.name ?? `#${row.task_id}`}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-faint">
                      {new Date(row.created_at).toLocaleTimeString()}
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

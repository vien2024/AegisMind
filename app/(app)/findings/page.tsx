import { FindingsClient } from "@/components/findings-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function FindingsPage() {
  await requirePageUser();
  const tasks = repo.listTasks();
  const findings = repo.listFindings().map((finding) => ({
    ...finding,
    task_name: tasks.find((task) => task.id === finding.task_id)?.name ?? null,
    asset_value: finding.asset_id ? repo.getAsset(finding.asset_id)?.value ?? null : null,
  }));
  const bySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  return <FindingsClient findings={findings} bySeverity={bySeverity} />;
}

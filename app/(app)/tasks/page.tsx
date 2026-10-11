import { TasksClient } from "@/components/tasks-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  await requirePageUser();
  const tasks = repo.listTasks().map((task) => ({
    ...task,
    counts: repo.nodeKindCounts(task.id),
    findings: repo.listFindings(task.id).length,
  }));
  return <TasksClient initialTasks={tasks} companies={repo.listCompanies()} />;
}

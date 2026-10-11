import { TasksClient } from "@/components/tasks-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  await requirePageUser();
  const tasks = (await repo.listTasks()).map(async (task) => ({
    ...task,
    counts: await repo.nodeKindCounts(task.id),
    findings: (await repo.listFindings(task.id)).length,
  }));
  const tasksWithCounts = await Promise.all(tasks);
  return <TasksClient initialTasks={tasksWithCounts} companies={await repo.listCompanies()} />;
}

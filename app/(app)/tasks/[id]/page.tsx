import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/task-detail";
import * as repo from "@/lib/repo";
import { taskGraph } from "@/lib/task-service";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const task = await repo.getTask(id);
  if (!task) notFound();
  const [graph, counts, activity, findings, approvals] = await Promise.all([
    taskGraph(id),
    repo.nodeKindCounts(id),
    repo.listActivity(id, 400),
    repo.listFindings(id),
    repo.listApprovals(id),
  ]);

  return (
    <TaskDetail
      initial={{
        task,
        counts,
        nodes: graph.nodes,
        edges: graph.edges,
        anchors: graph.anchors,
        assets: graph.assets,
        coverage: graph.coverage,
        activity,
        findings,
        approvals,
      }}
    />
  );
}

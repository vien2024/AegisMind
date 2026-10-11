import { notFound } from "next/navigation";
import { TaskDetail } from "@/components/task-detail";
import * as repo from "@/lib/repo";
import { coverageReport, taskGraph } from "@/lib/task-service";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const task = repo.getTask(id);
  if (!task) notFound();
  const graph = taskGraph(id);

  return (
    <TaskDetail
      initial={{
        task,
        counts: repo.nodeKindCounts(id),
        nodes: graph.nodes,
        edges: graph.edges,
        anchors: graph.anchors,
        assets: graph.assets,
        coverage: coverageReport(id),
      }}
    />
  );
}

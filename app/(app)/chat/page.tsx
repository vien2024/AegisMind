import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";
import { Icon } from "@/components/shell/icons";
import { Card, Empty, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string }>;
}) {
  await requirePageUser();
  const params = await searchParams;
  const tasks = repo.listTasks();
  const selected = params.taskId ? tasks.find((task) => task.id === Number(params.taskId)) : undefined;

  return (
    <>
      <SectionHeading
        title="Chat"
        subtitle="Talk to the main agent of a task — human in the loop, backed by the Vercel AI SDK"
      />

      {!selected ? (
        <Card title="Choose a task" icon="chat">
          {tasks.length === 0 ? (
            <Empty>No tasks yet — create one first.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/chat?taskId=${task.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-hover"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-ink">{task.name}</div>
                      <div className="mono truncate text-[11px] text-faint">{task.target}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={task.status} />
                      <Icon name="chevronRight" className="h-3.5 w-3.5 text-faint" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card
          title={selected.name}
          icon="chat"
          subtitle={selected.target}
          action={
            <Link className="btn px-2.5! py-1! text-[11px]!" href="/chat">
              Change task
            </Link>
          }
        >
          <ChatPanel taskId={selected.id} />
        </Card>
      )}
    </>
  );
}

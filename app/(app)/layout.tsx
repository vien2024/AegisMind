import { AppShell } from "@/components/shell/app-shell";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";
import { getSystemSettings } from "@/lib/repo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const pendingApprovals = (await repo.listApprovals()).filter((approval) => approval.status === "pending").length;

  return (
    <AppShell
      username={user.username}
      pendingApprovals={pendingApprovals}
      language={(await getSystemSettings()).language}
    >
      {children}
    </AppShell>
  );
}

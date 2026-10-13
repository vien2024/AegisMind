import { AppShell } from "@/components/shell/app-shell";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";
import { getSystemSettings } from "@/lib/repo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [pendingApprovals, settings] = await Promise.all([
    repo.countPendingApprovals(),
    getSystemSettings(),
  ]);

  return (
    <AppShell
      username={user.username}
      pendingApprovals={pendingApprovals}
      language={settings.language}
    >
      {children}
    </AppShell>
  );
}

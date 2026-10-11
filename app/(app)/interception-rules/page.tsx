import { InterceptionClient } from "@/components/interception-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function InterceptionRulesPage() {
  await requirePageUser();
  return <InterceptionClient autoApprove={(await repo.getSystemSettings()).autoApprove} />;
}

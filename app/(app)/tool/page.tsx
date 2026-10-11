import { UpstreamNotice } from "@/components/upstream-notice";
import { requirePageUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageUser();
  return <UpstreamNotice path="/tool" />;
}

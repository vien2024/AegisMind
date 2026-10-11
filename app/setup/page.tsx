import { redirect } from "next/navigation";
import { SetupForm } from "@/components/setup-form";
import { hasAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (hasAdmin()) redirect("/login");
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <SetupForm />
    </div>
  );
}

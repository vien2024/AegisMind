import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { hasAdmin } from "@/lib/auth";
import { resolveDbPath } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!hasAdmin()) redirect("/setup");
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <LoginForm dbPath={resolveDbPath().replace(process.cwd(), ".")} />
    </div>
  );
}

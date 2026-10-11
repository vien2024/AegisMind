"use client";

import { useState } from "react";

export function LoginForm({ dbPath }: { dbPath: string }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Invalid username or password.");
      return;
    }
    // Full navigation so the freshly issued session cookie is sent with the next document request.
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-[11px] font-bold text-accentfg">AM</span>
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Sign in</h1>
          <p className="text-[11px] text-muted">AegisMind — Next.js edition</p>
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted">Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted">Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-[10.5px] leading-relaxed text-faint">
        Lost the password? Reset the local account with{" "}
        <span className="mono">npm run reset-password -- &lt;user&gt; &lt;password&gt;</span>, or delete{" "}
        <span className="mono">{dbPath}</span> to start over at first-run setup.
      </p>
    </form>
  );
}

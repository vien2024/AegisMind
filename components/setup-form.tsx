"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icons";

export function SetupForm() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Setup failed");
      return;
    }
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-[11px] font-bold text-accentfg">AM</span>
        <div>
          <h1 className="text-[15px] font-semibold text-ink">First-run setup</h1>
          <p className="text-[11px] text-muted">Create the local administrator account.</p>
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted">Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted">Password (min 6 characters)</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-muted">Confirm password</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy || password.length < 6}>
        {busy ? "Creating…" : "Create administrator"}
      </button>
      <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />
        Demo fixtures (a fictional company and demo.example.com) are seeded on first run. This edition only
        runs agents with a configured live model; simulated reconnaissance is disabled.
      </p>
    </form>
  );
}

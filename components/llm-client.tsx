"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TokenUsageCard } from "@/components/dashboard/token-usage-card";
import { Icon } from "@/components/shell/icons";
import { Badge, Empty, SectionHeading } from "@/components/ui";
import type { ProviderId } from "@/lib/types";

interface ConfigRow {
  id: number;
  name: string;
  provider: ProviderId;
  model: string;
  base_url: string | null;
  has_key: boolean;
  temperature: number | null;
  is_active: number;
}

interface Template {
  id: string;
  label: string;
  note: string;
  provider: ProviderId;
  model: string;
  base_url: string;
  needsKey: boolean;
  links: Array<{ label: string; href: string }>;
}

const TEMPLATES: Template[] = [
  {
    id: "openai",
    label: "OpenAI · Chat Completions (recommended)",
    note: "Uses the standard OpenAI Chat Completions endpoint. The key is stored only in your local database and is never returned by the API.",
    provider: "openai",
    model: "gpt-4o-mini",
    base_url: "",
    needsKey: true,
    links: [{ label: "Create an API key", href: "https://platform.openai.com/api-keys" }],
  },
  {
    id: "anthropic",
    label: "Anthropic · Messages",
    note: "Claude models through the Anthropic Messages API. Good default for long multi-step tool loops.",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    base_url: "",
    needsKey: true,
    links: [{ label: "Create an API key", href: "https://console.anthropic.com/settings/keys" }],
  },
  {
    id: "openrouter",
    label: "OpenRouter · multi-provider router",
    note: "One OpenAI-compatible endpoint for hundreds of models from many vendors (openai/…, anthropic/…, google/…). Model ids are vendor-prefixed; keys look like sk-or-v1-…. Requests are billed and rate-limited by OpenRouter.",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    base_url: "https://openrouter.ai/api/v1",
    needsKey: true,
    links: [
      { label: "Create an API key", href: "https://openrouter.ai/keys" },
      { label: "Model list", href: "https://openrouter.ai/models" },
    ],
  },
  {
    id: "orcarouter",
    label: "Orca Router · multi-provider gateway",
    note: "OpenAI-compatible gateway that routes one endpoint to OpenAI and Anthropic upstreams (a native Anthropic surface is available too). Keys look like sk-orca-… and model ids are provider-prefixed, e.g. anthropic/claude-sonnet-4.6.",
    provider: "orcarouter",
    model: "openai/gpt-4o-mini",
    base_url: "https://api.orcarouter.ai/v1",
    needsKey: true,
    links: [
      { label: "Get an API key", href: "https://www.orcarouter.ai/" },
      { label: "Docs", href: "https://docs.orcarouter.ai/" },
    ],
  },
  {
    id: "glm",
    label: "Z.ai GLM-5.3 · General API",
    note: "Prefills an OpenAI-compatible gateway. Confirm model access and billing with your own Z.ai account. Selection does not save or activate a profile.",
    provider: "openai",
    model: "glm-5.3",
    base_url: "https://api.z.ai/api/paas/v4",
    needsKey: true,
    links: [{ label: "GLM-5.3 model guide", href: "https://docs.z.ai/" }],
  },
  {
    id: "mock",
    label: "Offline simulator (no API key)",
    note: "A deterministic local LanguageModelV4. The full AI SDK agent loop runs, with no network access and no credentials.",
    provider: "mock",
    model: "aegismind-simulator",
    base_url: "",
    needsKey: false,
    links: [],
  },
];

const KEY_PLACEHOLDER: Partial<Record<ProviderId, string>> = {
  openrouter: "sk-or-v1-…",
  orcarouter: "sk-orca-…",
};

const KEY_HINT: Partial<Record<ProviderId, string>> = {
  openai: "OpenAI key (sk-…).",
  anthropic: "Anthropic key (sk-ant-…).",
  openrouter: "OpenRouter key (sk-or-v1-…), or set OPENROUTER_API_KEY on the server.",
  orcarouter: "Orca Router key (sk-orca-…), or set ORCAROUTER_API_KEY on the server.",
};

export function LlmClient({
  configs,
  env,
  usageInitial,
}: {
  configs: ConfigRow[];
  env: { openai: boolean; anthropic: boolean; openrouter: boolean; orcarouter: boolean };
  usageInitial: React.ComponentProps<typeof TokenUsageCard>["initial"];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"profiles" | "usage">("profiles");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rows, setRows] = useState(configs);
  const [preset, setPreset] = useState(TEMPLATES[0]!.id);
  const [form, setForm] = useState(() => formFor(TEMPLATES[0]!));
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const template = TEMPLATES.find((entry) => entry.id === preset) ?? TEMPLATES[0]!;

  const reload = useCallback(async () => {
    const response = await fetch("/api/llm", { cache: "no-store" });
    if (response.ok) setRows(((await response.json()) as { configs: ConfigRow[] }).configs);
    router.refresh();
  }, [router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function formFor(entry: Template) {
    return {
      name: entry.provider === "openai" && entry.id === "glm" ? "GLM-5.3" : entry.label.split(" ·")[0]!,
      provider: entry.provider,
      model: entry.model,
      baseUrl: entry.base_url,
      apiKey: "",
      temperature: "",
    };
  }

  async function testConnection() {
    setBusy(true);
    setTestResult("Testing…");
    setTestOk(null);
    const response = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
        apiKey: form.apiKey || undefined,
      }),
    });
    const payload = (await response.json()) as { ok?: boolean; latencyMs?: number; error?: string; live?: boolean };
    setBusy(false);
    setTestOk(Boolean(payload.ok));
    setTestResult(
      payload.ok
        ? `Connected in ${payload.latencyMs} ms${payload.live ? "" : " (offline simulator)"}`
        : (payload.error ?? "Connection failed"),
    );
  }

  async function createProfile() {
    setBusy(true);
    const response = await fetch("/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name || undefined,
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
        apiKey: form.apiKey || undefined,
        temperature: form.temperature ? Number(form.temperature) : undefined,
        activate: false,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setTestOk(false);
      setTestResult(payload.error ?? "Could not save profile");
      return;
    }
    setSheetOpen(false);
    setForm(formFor(TEMPLATES[0]!));
    setTestResult(null);
    await reload();
  }

  async function activate(id: number) {
    await fetch(`/api/llm/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activate: true }),
    });
    await reload();
  }

  async function remove(id: number) {
    await fetch(`/api/llm/${id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <>
      <SectionHeading
        title="LLM"
        subtitle="Model profiles and token accounting"
        action={
          <button className="btn btn-primary" type="button" onClick={() => setSheetOpen(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New model profile
          </button>
        }
      />

      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {[
          { id: "profiles" as const, label: "Model configuration" },
          { id: "usage" as const, label: "Token usage" },
        ].map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="border-l border-border px-3 py-1.5 text-[12px] first:border-l-0"
            style={
              tab === entry.id
                ? { background: "var(--hover)", color: "var(--ink)", fontWeight: 600 }
                : { color: "var(--muted)" }
            }
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "usage" ? (
        <TokenUsageCard initial={usageInitial} />
      ) : (
        <section className="card">
          <header className="card-header">
            <h2 className="card-title">
              <Icon name="cpu" className="h-4 w-4 text-muted" />
              Model profiles
            </h2>
            <span className="text-[11px] text-faint">{rows.length} configured</span>
          </header>
          <div className="card-body">
            {rows.length === 0 ? (
              <Empty icon="cpu">
                No model profile yet. Agent runs currently use the offline simulator
                {env.openai || env.anthropic || env.openrouter || env.orcarouter ? " or an environment key" : ""}.
              </Empty>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{row.name}</span>
                        {row.is_active === 1 && <Badge tone="running">active</Badge>}
                        {row.has_key ? <Badge tone="completed">key set</Badge> : <Badge tone="neutral">no key</Badge>}
                      </div>
                      <div className="mono mt-0.5 truncate text-[11px] text-muted">
                        {row.provider} · {row.model}
                        {row.base_url ? ` · ${row.base_url}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {row.is_active !== 1 && (
                        <button className="btn px-2.5! py-1! text-[11px]!" type="button" onClick={() => activate(row.id)}>
                          Set active
                        </button>
                      )}
                      <button className="btn btn-danger px-2.5! py-1! text-[11px]!" type="button" onClick={() => remove(row.id)}>
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSheetOpen(false)}
          />
          <aside className="scroll relative z-10 h-full w-full max-w-[560px] overflow-y-auto border-l border-border bg-bg">
            <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-bg px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-ink">New model profile</h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  New profiles are not activated automatically. Choose Set active on the card to enable.
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close">
                <Icon name="x" className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-border p-3">
                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-ink">Configuration template (new profile only)</span>
                  <select
                    value={preset}
                    onChange={(event) => {
                      const entry = TEMPLATES.find((item) => item.id === event.target.value) ?? TEMPLATES[0]!;
                      setPreset(entry.id);
                      setForm(formFor(entry));
                      setTestResult(null);
                      setTestOk(null);
                    }}
                  >
                    {TEMPLATES.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{template.note}</p>
                {template.links.length > 0 && (
                  <div className="mt-2 flex gap-3">
                    {template.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-link underline"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-ink">Name</span>
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-ink">Format</span>
                  <select
                    value={form.provider}
                    onChange={(event) => setForm({ ...form, provider: event.target.value as ProviderId })}
                  >
                    <option value="openai">OpenAI (Chat Completions)</option>
                    <option value="anthropic">Anthropic (Messages)</option>
                    <option value="openrouter">OpenRouter (OpenAI-compatible)</option>
                    <option value="orcarouter">Orca Router (OpenAI-compatible)</option>
                    <option value="mock">Offline simulator</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink">Model</span>
                <input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
              </label>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink">Base URL (optional)</span>
                <input
                  value={form.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                />
                <span className="block text-[11px] text-faint">
                  Point at an OpenAI-compatible gateway to use a different provider.
                </span>
              </label>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-ink">API key</span>
                <input
                  type="password"
                  value={form.apiKey}
                  disabled={form.provider === "mock"}
                  placeholder={form.provider === "mock" ? "—" : (KEY_PLACEHOLDER[form.provider] ?? "sk-…")}
                  onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                />
                <span className="block text-[11px] text-faint">
                  {form.provider === "mock"
                    ? "The offline simulator needs no credentials."
                    : `${KEY_HINT[form.provider] ?? "Point Base URL at an OpenAI-compatible gateway."} Stored in the local SQLite database; never returned by the API.`}
                </span>
              </label>

              <label className="block max-w-[200px] space-y-1">
                <span className="text-[12px] font-medium text-ink">Temperature (optional)</span>
                <input
                  value={form.temperature}
                  placeholder="0.2"
                  onChange={(event) => setForm({ ...form, temperature: event.target.value })}
                />
              </label>

              {testResult && (
                <div
                  className="rounded-lg border px-3 py-2 text-[11px]"
                  style={{
                    borderColor: testOk === null ? "var(--border)" : testOk ? "#86efac" : "#fca5a5",
                    color: testOk === null ? "var(--muted)" : testOk ? "#15803d" : "#b91c1c",
                  }}
                >
                  {testResult}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-bg px-5 py-3">
              <button className="btn" type="button" disabled={busy || !form.model} onClick={testConnection}>
                <Icon name="workflow" className="h-3.5 w-3.5" />
                Test connection
              </button>
              <button className="btn btn-primary" type="button" disabled={busy || !form.model} onClick={createProfile}>
                <Icon name="plus" className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

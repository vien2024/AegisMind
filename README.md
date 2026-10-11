# AegisMind — Next.js edition

A local, single-process rebuild of [AegisMind](https://github.com/cskwork/aegismind) (itself a
derivative of [Autumn-27/ARTEX](https://github.com/Autumn-27/ARTEX)) in which **both the frontend and
the backend are Next.js** and every agent workflow is implemented with the
**[Vercel AI SDK](https://ai-sdk.dev)**.

The original project is a Go backend (`net/http` + PostgreSQL + a recording MITM proxy) with a
Next.js frontend embedded into a single binary through `go:embed`, and its agents are built on the
`norma` SDK. This edition keeps the concepts — the two-graph architecture, the planner/worker
split, the shared planning todolist, process-level worker traces, the interception gate — and
re-expresses them with:

| Original | This edition |
| --- | --- |
| Go `net/http` API + SSE | Next.js **Route Handlers** (`app/api/**`) + SSE |
| Next.js static export embedded with `go:embed` | Next.js App Router (server components + client components) |
| PostgreSQL via `pgx`, schema embedded on start | **SQLite** via `better-sqlite3`, schema created idempotently on start |
| `norma` agent SDK (`agentcore`/`tool`/`permission`/`harness`) | **Vercel AI SDK** (`tool`, `ToolLoopAgent`, `stopWhen`, `createAgentUIStreamResponse`) |
| Recording MITM proxy + Kali tooling | **Local, offline simulator** (see [Safety](#safety-and-scope)) |
| Planner/worker goroutines in one Go process | Planner/worker agents scheduled by an in-process engine loop |

> **This is a local, offline edition.** Nothing in it contacts a network. All reconnaissance is
> simulated. See [Safety and scope](#safety-and-scope).

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

The first visit redirects to `/setup`, where you create the local administrator password. Demo
fixtures (a fictional company and `demo.example.com` with subdomains) are seeded automatically.

No API key is required: with no provider configured, the agents run against a built-in
deterministic **simulator model** (a real `LanguageModelV4` implementation, so the AI SDK code path
is identical). Add an OpenAI, Anthropic, OpenRouter or Orca Router key on **Settings → LLM
configuration** — or export `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` /
`ORCAROUTER_API_KEY` — to run live agent workflows.

```bash
npm run build          # production build
npm run start          # serve the production build
npm run typecheck      # tsc --noEmit
npm run smoke:agent    # AI SDK tool-loop smoke test (no network)
npm run smoke:engine   # full planner/worker task run against a temp DB
```

### Environment (all optional)

```bash
OPENAI_API_KEY=sk-...            # or set it in the UI
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-v1-...
ORCAROUTER_API_KEY=sk-orca-...
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_MODEL=claude-sonnet-4-5
AEGISMIND_DB=./data/aegismind.db  # /app/data/aegismind.db in Docker
AEGISMIND_LANGUAGE=en             # or ko
NEXT_ALLOWED_DEV_ORIGINS=host.example   # extra dev origins (cloud previews), comma separated
```

### Run with Docker

The image is a multi-stage build that ends on Next.js `output: "standalone"`; the SQLite database
lives in the `/app/data` volume, so rebuilds and restarts keep your accounts, tasks and findings.

```bash
cp .env.example .env      # optional — every value has a working default
docker compose up -d --build
# open http://localhost:3000 → /setup for the first-run administrator password

docker compose logs -f    # follow the logs
docker compose down       # stop (data stays in the aegismind-data volume)
docker compose down -v    # stop and delete the data volume
```

Without compose:

```bash
docker build -t aegismind .
docker run -d --name aegismind -p 3000:3000 \
  -v aegismind-data:/app/data \
  -e OPENAI_API_KEY=sk-... \
  aegismind
```

Environment variables are read from `.env` by compose (`env_file`) or passed with `-e`. The
container ships a `HEALTHCHECK` against `GET /api/health`, an unauthenticated liveness probe that
also confirms the database is reachable. It runs as a non-root user; mount your own volume at
`/app/data` to persist state across container removal.

**Upgrading from a pre-rename install:** if `data/scopeweaver.db` exists and `data/aegismind.db`
does not, the app keeps using the older file, so the account and data survive the rename.

---

## Architecture

```
Next.js app (one Node process)
├── app/(app)/**            server components: dashboard, tasks, task detail, assets, findings, traffic, settings
├── components/**           client components: task controls, live graph view, AI SDK chat, settings forms
├── app/api/**              backend: REST route handlers, SSE streams, AI SDK chat stream
└── lib/
    ├── db.ts               SQLite connection + idempotent schema
    ├── repo.ts             data access for both graphs, tasks, findings, approvals, traffic, LLM config
    ├── engine.ts           the event-driven run loop (planner wake → intents → workers → write-back)
    ├── agents.ts           planner + worker agents (ToolLoopAgent), prompts and offline scripts
    ├── agent-tools.ts      the tool registry exposed to the agents (graph reads + writes + recon)
    ├── main-agent.ts       the human-in-the-loop "main agent" used by the chat panel
    ├── mock-model.ts       deterministic LanguageModelV4 used when no provider is configured
    ├── simulate.ts         deterministic offline reconnaissance simulator
    └── llm.ts              model resolution: active config → env key → simulator
```

### Two-graph architecture

AegisMind separates **what the target is** from **how far it has been tested**, and connects the
two through *anchors*:

* **Asset graph (global, shared)** — `assets` + `companies` + `task_scope`. Node kinds are
  `root_domain / subdomain / ip / service / app / endpoint`. Parent/child relationships and dedup
  keys are computed by the program; agents only submit raw observations.
* **Exploration graph (per task)** — `exploration_nodes` (`goal / intent / fact / finding / hint`)
  plus `exploration_edges` (`spawns / derived_from / yields / proves`) forming a lineage chain.
* **Anchors** — `exploration_anchors(node_id, asset_id)` attaches any intent/fact/finding to the
  assets it concerns. Coverage and the task-detail graph view are derived from these anchors.

### The engine loop (`lib/engine.ts`)

Event-driven and bounded per round:

1. A **planner wake** runs `runPlannerTurn`. The planner reads `get_graph_overview` + `get_coverage`,
   maintains the shared todolist, and sends **0..N intents** (`send_intent`) — most wakes send zero.
2. Pending intents are claimed up to the task's **concurrency**; each worker runs
   `runWorkerTurn` for exactly **one** intent.
3. A worker reads its intent context, searches other workers' traces, runs tools, then writes back
   assets/facts/findings before calling `finish_intent`.
4. The write-back wakes the planner again. When the planner finds no uncovered direction it calls
   `prove_goal`; after two consecutive empty wakes the engine also completes the task.

If the interception gate is on and a tool call is held, the task is set to **paused**, the intent to
`awaiting_approval`, and the operator's decision resumes the task automatically.

### Agent workflows with the Vercel AI SDK

Both agents are `ToolLoopAgent` instances built per turn from the active model:

```ts
const agent = new ToolLoopAgent({
  model,                       // OpenAI, Anthropic, or the offline simulator (LanguageModelV4)
  instructions: PLANNER_INSTRUCTIONS,
  tools: buildPlannerTools(ctx),   // tool({ description, inputSchema: z.object(...), execute })
  stopWhen: stepCountIs(settings.plannerMaxSteps),
});

await agent.generate({ prompt: plannerPrompt(task) });
```

The chat panel streams through the AI SDK UI protocol:

```ts
// app/api/tasks/[id]/chat/route.ts
return createAgentUIStreamResponse({ agent: buildMainAgent(id), uiMessages: messages });
```

```tsx
const transport = new DefaultChatTransport({ api: `/api/tasks/${taskId}/chat` });
const { messages, sendMessage, status } = useChat({ transport });
```

### Process-level information exchange between workers

A worker can search the execution process of *other* workers in the same task, not just formal
facts:

* `search_all_worker_traces(query)` — keyword search over other workers' recorded steps
  (own intent excluded), returning hits with an `intent_id`.
* `list_worker_traces()` — which intents have produced steps.
* `get_worker_trace(intent_id, step_ids?)` — pull full recorded step content.

### Tools exposed to agents

Planner: `get_graph_overview`, `get_coverage`, `read_todolist`, `update_todolist`,
`search_assets`, `send_intent`, `prove_goal`.

Worker: `get_intent_context`, `list_scope`, `search_all_worker_traces`, `list_worker_traces`,
`get_worker_trace`, `run_recon`, `dns_lookup`, `http_probe`, `submit_asset`, `submit_fact`,
`submit_finding`, `finish_intent`.

Everything that "touches" an asset (`run_recon`, `dns_lookup`, `http_probe`) passes through the
**interception gate**, which records an approval per task policy and holds the call when the task
requires manual approval.

---

## Interface

The UI mirrors the upstream product: a grouped sidebar (**Features** / **System**), a top bar with
search, theme toggle and account menu, and a light theme by default (dark theme available from the
top bar; the choice is stored in `localStorage`).

| Section | State |
| --- | --- |
| Dashboard, Tasks, Task detail, Findings, Traffic, Assets, Chat | Fully wired to this edition's backend |
| Tool executions, LLM recordings, Logs, Approval records | Wired to the interception gate, AI SDK usage records and activity log |
| Interception rules, System settings, LLM, Search | Wired to live settings and a real connection test |
| Asset sync, Workspace, Agent, MCP, Skill, Tool, Notifications, Asset blocking | Navigation placeholders — the section belongs to the upstream Go edition and states so on the page |

The **Dashboard** shows active tasks, confirmed findings, asset nodes, traffic interactions and
token usage, an **LLM token usage** chart (stacked input / output / cache-read bars, per-model
filter, 7-day to 1-year ranges), a live **activity feed** with type filters and a **findings**
panel. Token counts come from the `usage` the AI SDK reports for every planner and worker turn
(`llm_usage` table); in offline simulator mode the local model reports approximate counts and each
record is flagged `simulated`.

---

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/status` | first-run state + current session |
| `POST` | `/api/auth/setup` \| `/api/auth/login` \| `/api/auth/logout` | session lifecycle (HttpOnly cookie) |
| `GET`/`POST` | `/api/tasks` | list / create tasks |
| `GET`/`PATCH`/`DELETE` | `/api/tasks/[id]` | task detail, config, delete |
| `POST` | `/api/tasks/[id]/control` | `start` \| `pause` \| `resume` \| `stop` \| `reset` |
| `GET` | `/api/tasks/[id]/graph` | nodes, edges, anchors, coverage |
| `GET` | `/api/tasks/[id]/activity` | planner wakes and worker traces |
| `GET` | `/api/tasks/[id]/stream` | **SSE** live task events |
| `POST` | `/api/tasks/[id]/chat` | **AI SDK** UI message stream (main agent) |
| `GET` | `/api/tasks/[id]/report?format=md\|csv\|json` | report export |
| `GET` | `/api/assets` \| `/api/companies` | asset graph |
| `GET`/`POST`, `PATCH` | `/api/findings`, `/api/findings/[id]` | findings + dispositions |
| `GET` | `/api/traffic` | recorded traffic (simulated) |
| `GET`/`POST` | `/api/approvals` | interception gate records + decisions |
| `GET`/`POST`, `PATCH`/`DELETE` | `/api/llm`, `/api/llm/[id]` | LLM configurations (keys never returned) |
| `GET`/`PATCH` | `/api/settings` | language, concurrency, auto-approval |
| `GET` | `/api/overview` | dashboard aggregates |
| `GET` | `/api/events` | global SSE |

Every `/api/*` route except auth requires a session; UI pages redirect to `/setup` or `/login`.

---

## Safety and scope

The upstream project is a penetration-testing tool and ships usage restrictions that are **not**
relaxed here. This edition is deliberately narrower:

* **No network access.** `run_recon`, `dns_lookup` and `http_probe` are deterministic local
  simulations (`lib/simulate.ts`). They never open a socket and never contact a target.
* **Everything is labelled.** Simulated assets, traffic records and findings all carry a
  `simulated` marker, and the UI states when the offline simulator is active.
* **Local only.** Storage is a local SQLite file, and the app is intended to run on
  `localhost` for study, review and technical validation.

Do not use this software, or the upstream project, against systems you do not own or are not
explicitly authorised to test. The upstream licence (AGPL-3.0) and its usage restrictions and
disclaimer continue to apply to this derivative.

---

## Credits

* Upstream project and architecture: [Autumn-27/ARTEX](https://github.com/Autumn-27/ARTEX) and its
  AegisMind derivative.
* Agent SDK used here: [Vercel AI SDK](https://ai-sdk.dev).
* Concepts preserved: two-graph exploration, planner/worker autonomy, shared multi-round todolist,
  process-level worker exchange, interception approval gate.

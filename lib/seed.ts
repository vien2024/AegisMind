import { getSetting, db, now } from "./db";
import * as repo from "./repo";

const DEMO_COMPANY = "Demo Corp";
const DEMO_ROOT = "demo.example.com";
const DEMO_SUBDOMAINS = ["api.demo.example.com", "admin.demo.example.com"];

/**
 * Idempotent demo fixtures. These mirror AegisMind's bundled fictional demo
 * data: nothing here corresponds to a live host, and running a task against it
 * only exercises the local simulator.
 */
export function seedDemoData(): void {
  if (getSetting("seeded") === "1") return;

  const company =
    repo.listCompanies().find((c) => c.name === DEMO_COMPANY) ??
    repo.createCompany(DEMO_COMPANY, "Fictional demonstration company (offline fixtures).");

  const root = repo.upsertAsset({
    companyId: company.id,
    kind: "root_domain",
    value: DEMO_ROOT,
    attributes: { source: "demo-fixture" },
  }).asset;

  for (const name of DEMO_SUBDOMAINS) {
    repo.upsertAsset({
      companyId: company.id,
      kind: "subdomain",
      value: name,
      parentId: root.id,
      attributes: { source: "demo-fixture" },
    });
  }

  repo.upsertAsset({
    companyId: company.id,
    kind: "service",
    value: `${DEMO_ROOT}:443`,
    parentId: root.id,
    attributes: { source: "demo-fixture", port: 443, protocol: "https" },
  });

  db()
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
    .run("seeded", "1");
  db()
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
    .run("language", process.env.AEGISMIND_LANGUAGE ?? "en");

  repo.addActivity({
    taskId: 0,
    role: "system",
    type: "event",
    title: `demo fixtures seeded at ${now()}`,
  });
}

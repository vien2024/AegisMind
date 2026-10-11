import { getSetting, db, now } from "./db";
import * as repo from "./repo";

const DEMO_COMPANY = "Demo Corp";
const DEMO_ROOT = "demo.example.com";
const DEMO_SUBDOMAINS = ["api.demo.example.com", "admin.demo.example.com"];

/** Idempotent demo fixtures. These mirror AegisMind's bundled fictional demo
 *  data: nothing here corresponds to a live host, and running a task against it
 *  only exercises the local simulator.
 */
export async function seedDemoData(): Promise<void> {
  if ((await getSetting("seeded")) === "1") return;

  const companies = await repo.listCompanies();
  const company =
    companies.find((c) => c.name === DEMO_COMPANY) ??
    (await repo.createCompany(
      DEMO_COMPANY,
      "Fictional demonstration company (offline fixtures).",
    ));

  const root = (await repo.upsertAsset({
    companyId: company.id,
    kind: "root_domain",
    value: DEMO_ROOT,
    attributes: { source: "demo-fixture" },
  })).asset;

  for (const name of DEMO_SUBDOMAINS) {
    await repo.upsertAsset({
      companyId: company.id,
      kind: "subdomain",
      value: name,
      parentId: root.id,
      attributes: { source: "demo-fixture" },
    });
  }

  await repo.upsertAsset({
    companyId: company.id,
    kind: "service",
    value: `${DEMO_ROOT}:443`,
    parentId: root.id,
    attributes: { source: "demo-fixture", port: 443, protocol: "https" },
  });

  await db()
    .prepare("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING")
    .run("seeded", "1");
  await db()
    .prepare("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING")
    .run("language", process.env.AEGISMIND_LANGUAGE ?? "en");

  await repo.addActivity({
    taskId: 0,
    role: "system",
    type: "event",
    title: `demo fixtures seeded at ${now()}`,
  });
}

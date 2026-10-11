import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { UPSTREAM_SECTIONS } from "@/components/shell/nav-items";
import { Card, Empty, SectionHeading } from "@/components/ui";

export function UpstreamNotice({ path }: { path: string }) {
  const section = UPSTREAM_SECTIONS[path] ?? { title: "Section", blurb: "Not part of this edition." };
  return (
    <>
      <SectionHeading title={section.title} subtitle="Upstream-only section" />
      <Card title="Not included in the Next.js edition" icon="alert">
        <p className="text-[12px] leading-relaxed text-muted">{section.blurb}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn" href="/">
            <Icon name="dashboard" className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <Link className="btn" href="/settings">
            <Icon name="settings" className="h-3.5 w-3.5" /> System settings
          </Link>
        </div>
        <div className="mt-4">
          <Empty icon="inbox">
            The navigation mirrors the upstream product so the layout is familiar; only the sections wired to
            this edition's backend are functional.
          </Empty>
        </div>
      </Card>
    </>
  );
}

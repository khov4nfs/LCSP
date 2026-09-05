import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { resolveAppMessage } from "@/lib/i18n";

export function ArtifactEmptyState() {
  return <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"><h2 className="text-lg font-semibold">{resolveAppMessage("pages.artifacts.emptyTitle")}</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">{resolveAppMessage("pages.artifacts.emptyDescription")}</p><Link href="/assessments/new" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><PlusIcon className="size-4" />{resolveAppMessage("pages.artifacts.newArtifact")}</Link></div>;
}

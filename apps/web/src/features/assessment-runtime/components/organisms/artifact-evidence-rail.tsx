import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import type { NormalizedAssessmentArtifacts } from "../../../workspace/types/assessment-runtime-adapter.types";
import { ArtifactEvidenceRow } from "../molecules/artifact-evidence-row";

export function ArtifactEvidenceRail({ artifacts }: { artifacts: NormalizedAssessmentArtifacts }) {
  return <section aria-label={resolveAppMessage("pages.appShell.runtimePanelArtifacts" as MessageKey)}><p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">{resolveAppMessage("pages.appShell.runtimePanelArtifacts" as MessageKey)}</p><div className="space-y-2">{artifacts.items.map((item) => <ArtifactEvidenceRow key={item.id} item={item} />)}</div></section>;
}

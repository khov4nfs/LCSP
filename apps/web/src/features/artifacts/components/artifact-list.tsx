import { ArtifactListItem } from "./artifact-list-item";
import type { ArtifactGroup } from "../types/artifact.types";

export function ArtifactList({ groups }: { groups: ArtifactGroup[] }) {
  return <div className="space-y-8">{groups.map((group) => <section key={group.assessmentId} aria-labelledby={`artifact-group-${group.assessmentId}`}><div className="mb-3"><h2 id={`artifact-group-${group.assessmentId}`} className="text-base font-semibold">{group.title}</h2>{group.context ? <p className="text-sm text-muted-foreground">{group.context}{group.updatedAt ? ` · ${group.updatedAt}` : ""}</p> : null}</div><div className="grid gap-3 md:grid-cols-2">{group.artifacts.map((item) => <ArtifactListItem key={`${item.ref.type}-${item.ref.resourceId ?? "synthetic"}`} item={item} />)}</div></section>)}</div>;
}

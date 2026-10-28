import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import type { ComplianceRuleSetResultSourcesProps } from "../../types/compliance-rule-set-result.types";

export function ComplianceRuleSetResultSources({
  sources,
}: ComplianceRuleSetResultSourcesProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">
        {resolveAppMessage("pages.complianceRuleSets.result.sources")}
      </h4>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {resolveAppMessage("pages.complianceRuleSets.result.noneStated")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((source) => (
            <li
              key={`${source.chunkId}-${source.documentId}-${source.locator}`}
              className="rounded-md border border-border/70 p-3"
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {resolveAppMessage(
                      "pages.complianceRuleSets.result.documentId",
                    )}
                  </dt>
                  <dd className="break-all text-sm">{source.documentId}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {resolveAppMessage(
                      "pages.complianceRuleSets.result.locator",
                    )}
                  </dt>
                  <dd className="text-sm">{source.locator}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {resolveAppMessage(
                      "pages.complianceRuleSets.result.contentHash",
                    )}
                  </dt>
                  <dd className="font-mono text-xs">
                    {source.contentSha256.slice(
                      "sha256:".length,
                      "sha256:".length + 12,
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {resolveAppMessage(
                      "pages.complianceRuleSets.result.effectStatus",
                    )}
                  </dt>
                  <dd>
                    <Badge variant="outline">{source.sourceEffectStatus}</Badge>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

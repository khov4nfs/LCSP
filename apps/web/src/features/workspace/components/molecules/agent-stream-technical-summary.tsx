import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import type { AgentStreamTurnProps } from "../../types/agent-stream-turn.types";
import { projectAgentStreamTechnicalSummary } from "../../utils/agent-stream-technical-summary";

export function AgentStreamTechnicalSummary({
  events,
  stageEvents,
}: Pick<AgentStreamTurnProps, "events" | "stageEvents">) {
  const summary = projectAgentStreamTechnicalSummary(events, stageEvents);
  return (
    <div
      data-stream-technical-summary
      className="mt-2 space-y-1 text-xs text-muted-foreground"
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(summary)
          .filter(([key]) => key !== "files")
          .map(([key, count]) => (
            <div key={key} className="contents">
              <dt>
                {resolveMessage(
                  appLocale,
                  `pages.appShell.agentStreamTechnicalSummary.${key}` as Parameters<
                    typeof resolveMessage
                  >[1],
                )}
              </dt>
              <dd>{count}</dd>
            </div>
          ))}
      </dl>
      {summary.files.length > 0 ? (
        <details data-stream-source-files>
          <summary className="cursor-pointer">
            {resolveMessage(
              appLocale,
              "pages.appShell.agentStreamTechnicalSummary.sourceFiles",
            )}
          </summary>
          <ul className="mt-1 space-y-1 break-all font-mono">
            {summary.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

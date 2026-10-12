/** Historical commands are rejected at enqueue/replay; no handler or schema is retained. */
const retiredEventTypes = new Set<string>([
  "command.scan.requested.v1",
  "command.scan.targeted-reanalysis.v1",
  "command.assessment-interview.pause-agent.v1",
  "command.assessment-interview.resume-agent.v1",
  "command.legal-matching.requested.v1",
  "command.legal-corpus.recovery.requested.v1",
  "event.technical-evidence.accepted.v1",
  "event.technical-profile.ready.v1",
  "event.ai-usage-flow.ready.v1",
  "event.classification-result.ready.v1",
  "event.reconciliation.all-conflicts-resolved.v1",
  "document.final-report-requested",
  "document.gap-analysis-requested",
]);
export const isRetiredOutboxEventType = (eventType: string): boolean =>
  retiredEventTypes.has(eventType);

import type { MessageKey } from "@lcsp/i18n";

import {
  PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES,
  type ProgramEvidenceGraphDetailLoadState,
} from "@/lib/api/evidence-graph-detail-client";

/** Refetch cadence while the scanner is still building the evidence graph. */
export const PROGRAM_EVIDENCE_GRAPH_PENDING_POLL_MS = 5_000;

export const PROGRAM_EVIDENCE_GRAPH_UNAVAILABLE_MESSAGE_KEYS: Record<
  Exclude<
    ProgramEvidenceGraphDetailLoadState,
    typeof PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready
  >,
  MessageKey
> = {
  [PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.pending]:
    "pages.assessmentFlow.graph.building",
  [PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.failed]:
    "pages.assessmentFlow.graph.buildFailed",
  [PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.notFound]:
    "pages.assessmentFlow.graph.notFound",
  [PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.unavailable]:
    "pages.assessmentFlow.graph.loadError",
};

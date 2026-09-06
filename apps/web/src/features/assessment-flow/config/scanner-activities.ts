export const SCANNER_ACTIVITY_IDS = {
  connect: "CONNECT_REPOSITORY",
  clone: "CLONE_SOURCE_ARCHIVE",
  scan: "SCAN_SOURCE_CODE",
  buildGraph: "BUILD_PROGRAM_EVIDENCE_GRAPH",
  collectEvidence: "COLLECT_EVIDENCE",
} as const;

export const SCANNER_ACTIVITY_CONFIG = [
  {
    id: SCANNER_ACTIVITY_IDS.connect,
    labelKey: "pages.assessmentFlow.scanner.activities.connect",
  },
  {
    id: SCANNER_ACTIVITY_IDS.clone,
    labelKey: "pages.assessmentFlow.scanner.activities.clone",
  },
  {
    id: SCANNER_ACTIVITY_IDS.scan,
    labelKey: "pages.assessmentFlow.scanner.activities.scan",
  },
  {
    id: SCANNER_ACTIVITY_IDS.buildGraph,
    labelKey: "pages.assessmentFlow.scanner.activities.buildGraph",
  },
  {
    id: SCANNER_ACTIVITY_IDS.collectEvidence,
    labelKey: "pages.assessmentFlow.scanner.activities.collectEvidence",
    runningLabelKey:
      "pages.assessmentFlow.scanner.activities.collectEvidenceRunning",
  },
] as const;

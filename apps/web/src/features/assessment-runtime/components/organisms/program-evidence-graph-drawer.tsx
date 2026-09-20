"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { XIcon } from "lucide-react";
import Link from "next/link";
import {
  ASSESSMENT_ARTIFACT_STATUSES,
  ASSESSMENT_ARTIFACT_TYPES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  AI_DISCOVERY_EVIDENCE_STATES,
  AI_DISCOVERY_RESOLUTION_STATES,
  type BusinessContextArtifact,
  type InvestigationNotesArtifact,
} from "@lcsp/contracts/evidence";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";
import {
  PROGRAM_EVIDENCE_GRAPH_PENDING_POLL_MS,
  PROGRAM_EVIDENCE_GRAPH_UNAVAILABLE_MESSAGE_KEYS,
} from "../../config/program-evidence-graph";
import {
  getProgramEvidenceGraphDetailState,
  PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES,
  type ProgramEvidenceGraphDetail,
  type ProgramEvidenceGraphDetailLoadState,
  type ProgramEvidenceGraphOverview,
} from "@/lib/api/evidence-graph-detail-client";
import {
  ARTIFACT_TYPES,
  type ArtifactRef,
} from "@/features/artifacts/types/artifact.types";
import {
  getBusinessContextArtifact,
  getInvestigationNotesArtifact,
} from "@/lib/api/assessment-artifact-client";
import {
  AssessmentTextArtifactDialog,
  type AssessmentTextArtifact,
} from "./assessment-text-artifact-dialog";
import {
  ARTIFACT_OPEN_KINDS,
  buildArtifactOpenTarget,
} from "@/features/artifacts/utils/artifact-routes";
import {
  formatProgramEvidenceMetric,
  PROGRAM_EVIDENCE_OVERVIEW_FORMATS,
} from "@/features/assessment-flow/utils/program-evidence-summary";
import {
  fitGraphToViewport,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  findLabelPlacement,
  LABEL_TO_LABEL_CLEARANCE,
  routeGraphEdge,
  selectEvidenceTopology,
  zoomAtPoint,
  type ViewportState,
} from "../../utils/program-evidence-path-map";

const MAX_PERSISTENT_RELATIONSHIP_LABELS = 8;

type GraphNode = ProgramEvidenceGraphDetail["paths"]["nodes"][number];
type GraphEdge = ProgramEvidenceGraphDetail["paths"]["edges"][number];

const AI_USAGE_ROLE_MESSAGE_KEYS = {
  MODULE_FEATURE: "moduleFeature",
  ROUTE_HANDLER_FEATURE: "routeHandlerFeature",
  SERVICE_CLIENT: "serviceClient",
  AI_SDK: "aiSdk",
  AI_SDK_INVOCATION: "aiSdkInvocation",
  AI_API_ENDPOINT: "aiApiEndpoint",
  AI_GATEWAY: "aiGateway",
  AI_PROVIDER: "aiProvider",
  MODEL_IDENTITY: "modelIdentity",
  CONFIG_CONTROL: "configControl",
  UNRESOLVED_AI_CANDIDATE: "unresolvedCandidate",
} as const;

type DrawerContextValue = {
  openArtifact: (ref: ArtifactRef, trigger?: HTMLElement | null) => void;
  overview: ProgramEvidenceGraphOverview | null;
};
const DrawerContext = createContext<DrawerContextValue>({
  openArtifact: () => undefined,
  overview: null,
});

export function ProgramEvidenceGraphProvider({
  assessmentId,
  children,
}: {
  assessmentId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ProgramEvidenceGraphDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadState, setLoadState] =
    useState<ProgramEvidenceGraphDetailLoadState>(
      PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.unavailable,
    );
  const [textArtifactOpen, setTextArtifactOpen] = useState(false);
  const [textArtifactLoading, setTextArtifactLoading] = useState(false);
  const [textArtifact, setTextArtifact] =
    useState<AssessmentTextArtifact | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const requestVersionRef = useRef(0);
  const loadDetail = useCallback(() => {
    if (!assessmentId) return;
    const requestVersion = ++requestVersionRef.current;
    // Keep a previously rendered graph visible while a later open refreshes it.
    setLoading(true);
    void getProgramEvidenceGraphDetailState(assessmentId)
      .then((value) => {
        if (requestVersion === requestVersionRef.current) {
          setDetail(value.detail);
          setLoadState(value.state);
          setLoading(false);
        }
      })
      .catch(() => {
        if (requestVersion === requestVersionRef.current) {
          setDetail(null);
          setLoadState(PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.unavailable);
          setLoading(false);
        }
      });
  }, [assessmentId]);
  const openArtifact = (ref: ArtifactRef, trigger?: HTMLElement | null) => {
    if (ref.assessmentId !== assessmentId) return;
    triggerRef.current = trigger ?? null;
    if (ref.type === ARTIFACT_TYPES.programEvidenceGraph) {
      setOpen(true);
      loadDetail();
      return;
    }
    if (
      ref.type !== ARTIFACT_TYPES.businessContext &&
      ref.type !== ARTIFACT_TYPES.investigationNotes
    ) {
      return;
    }
    setTextArtifact(null);
    setTextArtifactOpen(true);
    setTextArtifactLoading(true);
    const request =
      ref.type === ARTIFACT_TYPES.businessContext
        ? getBusinessContextArtifact(ref.assessmentId)
        : getInvestigationNotesArtifact(ref.assessmentId);
    void request
      .then(
        (
          value: BusinessContextArtifact | InvestigationNotesArtifact | null,
        ) => {
          if (
            value?.status === ASSESSMENT_ARTIFACT_STATUSES.ready &&
            value.content &&
            ((ref.type === ARTIFACT_TYPES.businessContext &&
              value.type === ASSESSMENT_ARTIFACT_TYPES.businessContext) ||
              (ref.type === ARTIFACT_TYPES.investigationNotes &&
                value.type === ASSESSMENT_ARTIFACT_TYPES.investigationNotes))
          ) {
            setTextArtifact(value);
          } else {
            setTextArtifact(value);
          }
        },
      )
      .catch(() => setTextArtifact(null))
      .finally(() => setTextArtifactLoading(false));
  };
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const trigger = triggerRef.current;
      if (trigger) requestAnimationFrame(() => trigger.focus());
    }
    wasOpenRef.current = open;
  }, [open]);
  const textWasOpenRef = useRef(false);
  useEffect(() => {
    if (textWasOpenRef.current && !textArtifactOpen) {
      const trigger = triggerRef.current;
      if (trigger) requestAnimationFrame(() => trigger.focus());
    }
    textWasOpenRef.current = textArtifactOpen;
  }, [textArtifactOpen]);
  useEffect(() => {
    // A building graph is not an error: keep refetching while the drawer is open.
    if (
      !open ||
      loading ||
      loadState !== PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.pending
    ) {
      return;
    }
    const timer = setTimeout(
      loadDetail,
      PROGRAM_EVIDENCE_GRAPH_PENDING_POLL_MS,
    );
    return () => clearTimeout(timer);
  }, [open, loading, loadState, loadDetail]);
  return (
    <DrawerContext.Provider
      value={{ openArtifact, overview: detail?.overview ?? null }}
    >
      {children}
      {assessmentId ? (
        <>
          <ProgramEvidenceGraphDrawer
            assessmentId={assessmentId}
            detail={detail}
            loading={loading}
            loadState={loadState}
            open={open}
            onOpenChange={setOpen}
          />
          <AssessmentTextArtifactDialog
            artifact={textArtifact}
            loading={textArtifactLoading}
            open={textArtifactOpen}
            onOpenChange={setTextArtifactOpen}
          />
        </>
      ) : null}
    </DrawerContext.Provider>
  );
}

export function useProgramEvidenceGraphDrawer() {
  return useContext(DrawerContext);
}

function ProgramEvidenceGraphDrawer({
  assessmentId,
  detail,
  loading,
  loadState,
  open,
  onOpenChange,
}: {
  assessmentId: string;
  detail: ProgramEvidenceGraphDetail | null;
  loading: boolean;
  loadState: ProgramEvidenceGraphDetailLoadState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(820px,calc(100vh-2rem))] w-[min(1320px,calc(100vw-2rem))] max-w-none gap-0 p-0"
      >
        <DialogHeader className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-x-4 gap-y-1 px-6 py-2">
          <div className="min-h-4 min-w-0">
            {detail ? (
              <p className="truncate text-xs text-muted-foreground">
                {resolveAppMessage(
                  "pages.assessmentFlow.graph.repositoryEvidence" as never,
                )}{" "}
                ·{" "}
                {detail.repository.repository_full_name ??
                  resolveAppMessage(
                    "pages.assessmentFlow.graph.unavailable" as never,
                  )}{" "}
                ·{" "}
                {detail.repository.branch ??
                  detail.repository.ref ??
                  resolveAppMessage(
                    "pages.assessmentFlow.graph.unavailableValue" as never,
                  )}{" "}
                ·{" "}
                {detail.repository.pinned_commit ??
                  resolveAppMessage(
                    "pages.assessmentFlow.graph.unavailableValue" as never,
                  )}
              </p>
            ) : null}
          </div>
          <div className="col-start-1 row-start-2 flex min-w-0 flex-col items-start gap-1">
            <DialogTitle className="row-start-2 w-full text-left">
              {resolveAppMessage("pages.assessmentFlow.graph.title" as never)}
            </DialogTitle>
          </div>
          <div className="col-start-2 row-span-2 row-start-1 flex shrink-0 items-center gap-2">
            <div className="flex shrink-0 items-center gap-2">
              {detail?.repository.status ===
              ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready ? (
                <span className="inline-flex h-9 items-center justify-center rounded-full border border-border/70 px-3 text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.ready" as never,
                  )}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="inline-flex size-9 items-center justify-center p-0"
                onClick={() => onOpenChange(false)}
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.close" as never,
                )}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {loadState === PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.pending ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.building",
                )}
              />
              <span>
                {resolveAppMessage("pages.assessmentFlow.graph.building")}
              </span>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.loading" as never,
                )}
              />
              <span>
                {resolveAppMessage(
                  "pages.assessmentFlow.graph.loading" as never,
                )}
              </span>
            </div>
          ) : detail ? (
            <GraphFirstDetail assessmentId={assessmentId} detail={detail} />
          ) : (
            <p
              className="text-sm text-muted-foreground"
              data-graph-load-state={loadState}
            >
              {resolveAppMessage(
                loadState === PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready
                  ? "pages.assessmentFlow.graph.loadError"
                  : PROGRAM_EVIDENCE_GRAPH_UNAVAILABLE_MESSAGE_KEYS[loadState],
              )}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GraphFirstDetail({
  assessmentId,
  detail,
}: {
  assessmentId: string;
  detail: ProgramEvidenceGraphDetail;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const topology = selectEvidenceTopology(
    detail.paths.nodes,
    detail.paths.edges,
  );
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  const { zoom, pan } = viewport;
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    nodeId: string | null;
    dragging: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const selected =
    topology.nodes.find((node) => node.id === selectedId) ?? null;
  const incoming = selected
    ? topology.edges.filter((edge) => edge.target === selected.id)
    : [];
  const outgoing = selected
    ? topology.edges.filter((edge) => edge.source === selected.id)
    : [];
  const selectedIncidentDegree = incoming.length + outgoing.length;
  const showPersistentLabels =
    selectedIncidentDegree > 0 &&
    selectedIncidentDegree <= MAX_PERSISTENT_RELATIONSHIP_LABELS;
  // Fixed SVG viewport units keep the interactive transform authoritative;
  // Fit computes zoom/pan from the displayed scene bounds within this area.
  const width = 900;
  const height = 620;
  const fitViewport = () => {
    const next = fitGraphToViewport(topology.positions, { width, height });
    setViewport(next);
  };
  const target = buildArtifactOpenTarget({
    assessmentId,
    type: ARTIFACT_TYPES.programEvidenceGraph,
  });
  const selectedSource = selected?.file
    ? {
        file: selected.file,
        symbol: selected.symbol,
        start_line: selected.line,
        end_line: null,
        evidence_reference: null,
      }
    : null;
  const selectedClaims = selected
    ? detail.claims.filter(
        (claim) =>
          (selected.symbol && claim.symbol === selected.symbol) ||
          (selected.file &&
            claim.file === selected.file &&
            (selected.line === null || claim.line === selected.line)),
      )
    : [];
  const overflowingUsageGroups = (detail.paths.usage_flow_groups ?? []).filter(
    (group) => group.omitted_usage_flow_count > 0,
  );
  const visibleOverflowingUsageGroups = overflowingUsageGroups.slice(0, 4);
  const visibleOmittedUsageGroupCount = visibleOverflowingUsageGroups.filter(
    (group) => group.rendered_usage_flow_count === 0,
  ).length;
  const remainingOmittedUsageGroupCount = Math.max(
    0,
    (detail.paths.omitted_usage_group_count ?? 0) -
      visibleOmittedUsageGroupCount,
  );
  const nodeObstacles = topology.nodes.flatMap((node) => {
    const point = topology.positions.get(node.id);
    return point
      ? [
          {
            x: point.x,
            y: point.y - GRAPH_NODE_HEIGHT / 2,
            width: GRAPH_NODE_WIDTH,
            height: GRAPH_NODE_HEIGHT,
          },
        ]
      : [];
  });
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 px-6 py-3">
        <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-border/60 bg-card lg:grid-cols-4 lg:divide-x lg:divide-border/60">
          {(
            [
              ["modulesAnalyzed", detail.overview.modules_analyzed],
              ["codeSymbolsIndexed", detail.overview.code_symbols_indexed],
              ["aiModelInvocations", detail.overview.ai_model_invocations],
              ["evidenceMappedScope", detail.overview.evidence_mapped_scope],
            ] as const
          ).map(([key, value]) => (
            <div
              className="flex min-h-14 flex-col items-start justify-center gap-1 px-4 py-2 text-left"
              key={key}
            >
              <dd className="text-base font-semibold leading-none">
                {value == null
                  ? resolveAppMessage(
                      "pages.assessmentFlow.graph.unavailableValue" as never,
                    )
                  : formatProgramEvidenceMetric({
                      value,
                      format: PROGRAM_EVIDENCE_OVERVIEW_FORMATS[key],
                    })}
              </dd>
              <dt className="min-w-0 text-[0.6875rem] leading-tight text-muted-foreground">
                {resolveAppMessage(
                  `pages.assessmentFlow.graph.${key}` as never,
                )}
              </dt>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden px-6 pb-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4"
          aria-label={resolveAppMessage(
            "pages.assessmentFlow.graph.pathMap" as never,
          )}
        >
          <div className="col-start-1 row-start-1 mb-2 min-w-0 pr-32">
            <h3 className="text-sm font-semibold">
              {resolveAppMessage(
                "pages.assessmentFlow.graph.aiUsageTopologyTitle" as never,
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.assessmentFlow.graph.aiUsageTopologyDescription" as never,
              )}
            </p>
            {overflowingUsageGroups.length ? (
              <div className="mt-2 min-w-0">
                <p className="text-[0.6875rem] font-medium text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.omittedAiUsageGroups" as never,
                  )}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {visibleOverflowingUsageGroups.map((group) => (
                    <span
                      className="max-w-60 truncate rounded-full border border-amber-500/40 px-2 py-0.5 text-[0.6875rem] text-amber-700"
                      key={group.key}
                    >
                      {group.label}: {group.omitted_usage_flow_count}{" "}
                      {resolveAppMessage(
                        "pages.assessmentFlow.graph.hiddenAiUsageGroupFlows" as never,
                      )}
                    </span>
                  ))}
                  {remainingOmittedUsageGroupCount ? (
                    <span className="max-w-60 truncate rounded-full border border-amber-500/40 px-2 py-0.5 text-[0.6875rem] text-amber-700">
                      {remainingOmittedUsageGroupCount}{" "}
                      {resolveAppMessage(
                        "pages.assessmentFlow.graph.additionalOmittedAiUsageGroups" as never,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="col-start-1 row-start-1 mb-2 flex items-start justify-end text-[0.6875rem] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-border/60 px-2 py-1">
                {topology.nodes.length}{" "}
                {resolveAppMessage("pages.assessmentFlow.graph.nodes" as never)}
                {" · "}
                {topology.edges.length}{" "}
                {resolveAppMessage("pages.assessmentFlow.graph.edges" as never)}
              </span>
              {detail.paths.omitted_usage_flow_count ? (
                <span className="max-w-64 truncate rounded-full border border-amber-500/50 px-2 py-1 text-amber-700">
                  {detail.paths.omitted_usage_flow_count}{" "}
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.omittedAiUsagePaths" as never,
                  )}
                </span>
              ) : null}
              <span aria-hidden="true" className="h-4 w-px bg-border/70" />
              <div
                className="hidden shrink-0 items-center gap-1"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={resolveAppMessage(
                    "pages.assessmentFlow.graph.zoomOut" as never,
                  )}
                  onClick={() =>
                    setViewport((state) =>
                      zoomAtPoint(
                        state,
                        { x: width / 2, y: height / 2 },
                        state.zoom - 0.15,
                      ),
                    )
                  }
                >
                  −
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={resolveAppMessage(
                    "pages.assessmentFlow.graph.fitGraph" as never,
                  )}
                  onClick={() => {
                    fitViewport();
                  }}
                >
                  ⌂
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={resolveAppMessage(
                    "pages.assessmentFlow.graph.zoomIn" as never,
                  )}
                  onClick={() =>
                    setViewport((state) =>
                      zoomAtPoint(
                        state,
                        { x: width / 2, y: height / 2 },
                        state.zoom + 0.15,
                      ),
                    )
                  }
                >
                  +
                </Button>
              </div>
            </div>
          </div>
          <div className="relative col-start-1 row-start-2 min-h-0 overflow-hidden rounded-lg border border-border/60 bg-background">
            {!topology.nodes.length ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {resolveAppMessage(
                  "pages.assessmentFlow.graph.noAiUsagePaths" as never,
                )}
              </div>
            ) : null}
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-card/90 px-2 py-1 text-[0.6875rem] text-muted-foreground shadow-sm">
              ●{" "}
              {resolveAppMessage(
                "pages.assessmentFlow.graph.legendInspected" as never,
              )}
            </span>
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border border-border/70 bg-card/90 p-1 shadow-sm">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.zoomOut" as never,
                )}
                onClick={() =>
                  setViewport((state) =>
                    zoomAtPoint(
                      state,
                      { x: width / 2, y: height / 2 },
                      state.zoom - 0.15,
                    ),
                  )
                }
              >
                −
              </Button>
              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.zoomIn" as never,
                )}
                onClick={() =>
                  setViewport((state) =>
                    zoomAtPoint(
                      state,
                      { x: width / 2, y: height / 2 },
                      state.zoom + 0.15,
                    ),
                  )
                }
              >
                +
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs"
                aria-label={resolveAppMessage(
                  "pages.assessmentFlow.graph.fitGraph" as never,
                )}
                onClick={fitViewport}
              >
                {resolveAppMessage(
                  "pages.assessmentFlow.graph.fitGraph" as never,
                )}
              </Button>
            </div>
            <svg
              className="h-full min-h-[620px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              onPointerDown={(event) => {
                const target = event.target as Element;
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  panX: pan.x,
                  panY: pan.y,
                  nodeId:
                    target
                      .closest?.("[data-node-id]")
                      ?.getAttribute("data-node-id") ?? null,
                  dragging: false,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragRef.current) return;
                const distance = Math.hypot(
                  event.clientX - dragRef.current.x,
                  event.clientY - dragRef.current.y,
                );
                if (!dragRef.current.dragging && distance < 6) return;
                dragRef.current.dragging = true;
                suppressClickRef.current = true;
                const rect = event.currentTarget.getBoundingClientRect();
                const scaleX = width / rect.width;
                const scaleY = height / rect.height;
                const dragStart = dragRef.current;
                if (!dragStart) return;
                const nextPan = {
                  x: dragStart.panX + (event.clientX - dragStart.x) * scaleX,
                  y: dragStart.panY + (event.clientY - dragStart.y) * scaleY,
                };
                setViewport((state) => ({
                  ...state,
                  pan: {
                    x: nextPan.x,
                    y: nextPan.y,
                  },
                }));
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current;
                if (drag && !drag.dragging && drag.nodeId)
                  setSelectedId(drag.nodeId);
                dragRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                suppressClickRef.current = false;
              }}
              onWheel={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const point = {
                  x: ((event.clientX - rect.left) / rect.width) * width,
                  y: ((event.clientY - rect.top) / rect.height) * height,
                };
                setViewport((state) =>
                  zoomAtPoint(state, point, state.zoom - event.deltaY * 0.001),
                );
              }}
              aria-label={resolveAppMessage(
                "pages.assessmentFlow.graph.pathMap" as never,
              )}
            >
              <defs>
                <marker
                  id="pge-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  viewBox="0 0 8 6"
                  refX="7"
                  refY="3"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L7,3 z" className="fill-brand" />
                </marker>
                {topology.nodes.map((node, index) => {
                  const position = topology.positions.get(node.id);
                  if (!position) return null;
                  return (
                    <clipPath id={`pge-node-label-${index}`} key={node.id}>
                      <rect
                        x={position.x + 8}
                        y={position.y - 17}
                        width="134"
                        height="18"
                      />
                    </clipPath>
                  );
                })}
              </defs>
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                {(() => {
                  const placedLabelRects: Array<{
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                  }> = [];
                  return topology.edges.map((edge) => {
                    const from = topology.positions.get(edge.source);
                    const to = topology.positions.get(edge.target);
                    if (!from || !to) return null;
                    const points = routeGraphEdge(from, to, nodeObstacles);
                    const path = points
                      .map(
                        (point, index) =>
                          `${index ? "L" : "M"}${point.x},${point.y}`,
                      )
                      .join(" ");
                    const labelVisible = Boolean(
                      selected &&
                      (showPersistentLabels || hoveredEdgeId === edge.id) &&
                      (edge.source === selected.id ||
                        edge.target === selected.id),
                    );
                    const labelWidth = edge.relationship.length * 5.6 + 8;
                    const labelPoint = findLabelPlacement(
                      points,
                      labelWidth,
                      nodeObstacles,
                      16,
                      placedLabelRects,
                    );
                    const labelSafe = Boolean(labelPoint);
                    if (labelPoint && labelVisible) {
                      placedLabelRects.push({
                        x:
                          labelPoint.x -
                          labelWidth / 2 -
                          LABEL_TO_LABEL_CLEARANCE,
                        y: labelPoint.y - 8 - LABEL_TO_LABEL_CLEARANCE,
                        width: labelWidth + LABEL_TO_LABEL_CLEARANCE * 2,
                        height: 16 + LABEL_TO_LABEL_CLEARANCE * 2,
                      });
                    }
                    return (
                      <g key={edge.id}>
                        <path
                          d={path}
                          className={`fill-none ${
                            selected &&
                            (edge.source === selected.id ||
                              edge.target === selected.id)
                              ? "stroke-brand"
                              : selected
                                ? "stroke-muted-foreground/15"
                                : "stroke-muted-foreground/25"
                          }`}
                          strokeWidth={
                            selected &&
                            (edge.source === selected.id ||
                              edge.target === selected.id)
                              ? 2
                              : 1
                          }
                          markerEnd="url(#pge-arrow)"
                          strokeDasharray={
                            edge.resolution_state ===
                            AI_DISCOVERY_RESOLUTION_STATES.unresolved
                              ? "5 5"
                              : undefined
                          }
                          style={{ pointerEvents: "stroke" }}
                          tabIndex={0}
                          onMouseEnter={() => setHoveredEdgeId(edge.id)}
                          onMouseLeave={() => setHoveredEdgeId(null)}
                          onFocus={() => setHoveredEdgeId(edge.id)}
                          onBlur={() => setHoveredEdgeId(null)}
                        />
                        {labelVisible && labelSafe ? (
                          <rect
                            x={
                              (labelPoint?.x ?? from.x) -
                              edge.relationship.length * 2.8 -
                              4
                            }
                            y={(labelPoint?.y ?? from.y) - 8}
                            width={labelWidth}
                            height="16"
                            rx="3"
                            className="pointer-events-none fill-card/95 stroke-border/70"
                            strokeWidth="1"
                          />
                        ) : null}
                        <text
                          x={labelPoint?.x ?? from.x}
                          y={labelPoint?.y ?? from.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="pointer-events-none fill-muted-foreground text-[9px]"
                          visibility={
                            labelVisible && labelSafe ? "visible" : "hidden"
                          }
                        >
                          {edge.relationship}
                        </text>
                      </g>
                    );
                  });
                })()}
                {topology.nodes.map((node, index) => {
                  const position = topology.positions.get(node.id);
                  if (!position) return null;
                  const selectedNode = node.id === selected?.id;
                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      role="button"
                      tabIndex={0}
                      className="outline-none focus-visible:outline-none"
                      aria-label={node.label}
                      aria-pressed={selectedNode}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        setSelectedId(node.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          setSelectedId(node.id);
                      }}
                    >
                      <rect
                        x={position.x}
                        y={position.y - 22}
                        width={GRAPH_NODE_WIDTH}
                        height={GRAPH_NODE_HEIGHT}
                        rx="8"
                        className={
                          selectedNode
                            ? "fill-brand/20 stroke-brand"
                            : node.resolution_state ===
                                AI_DISCOVERY_RESOLUTION_STATES.unresolved
                              ? "fill-card stroke-amber-500"
                              : "fill-card stroke-border"
                        }
                        strokeWidth={selectedNode ? 2 : 1}
                      />
                      <text
                        x={position.x + 8}
                        y={position.y - 3}
                        clipPath={`url(#pge-node-label-${index})`}
                        className="fill-foreground text-[10px]"
                      >
                        {node.label}
                      </text>
                      <text
                        x={position.x + 8}
                        y={position.y + 12}
                        className="fill-muted-foreground text-[8px]"
                      >
                        {formatNodeCaption(node)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </section>
        <aside className="min-h-0 overflow-auto rounded-xl border border-border/70 bg-card p-4">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.selectedNode" as never,
                  )}
                </p>
                <span className="rounded-full border border-border/70 px-2 py-1 text-[0.6875rem] text-muted-foreground">
                  {formatAiUsageRole(selected)}
                </span>
              </div>
              <h3 className="mt-1 break-words text-base font-semibold">
                {selected.label}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatEvidenceStatus(selected)}
              </p>
              {selected.file ? (
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  {selected.file}
                  {selected.line ? `:${selected.line}` : ""}
                </p>
              ) : null}
              {selected.symbol ? (
                <p className="mt-1 break-words text-xs font-medium">
                  {selected.symbol}
                </p>
              ) : null}
              <section className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <h4 className="text-sm font-semibold">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.claims" as never,
                  )}
                </h4>
                {selectedClaims.length ? (
                  <div className="mt-2 space-y-2">
                    {selectedClaims.map((claim) => (
                      <div
                        className="rounded-md border border-border/60 p-2"
                        key={claim.id}
                      >
                        <p className="break-words text-xs">{claim.meaning}</p>
                        {claim.evidence_refs.length ? (
                          <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                            {resolveAppMessage(
                              "pages.assessmentFlow.graph.evidence" as never,
                            )}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {resolveAppMessage(
                      "pages.assessmentFlow.graph.noClaims" as never,
                    )}
                  </p>
                )}
              </section>
              <section className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <h4 className="text-sm font-semibold">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.relationships" as never,
                  )}
                </h4>
                {incoming.length ? (
                  <RelationshipList
                    title={resolveAppMessage(
                      "pages.assessmentFlow.graph.incoming" as never,
                    )}
                    edges={incoming}
                    nodes={topology.nodes}
                    incoming
                  />
                ) : null}
                {outgoing.length ? (
                  <RelationshipList
                    title={resolveAppMessage(
                      "pages.assessmentFlow.graph.outgoing" as never,
                    )}
                    edges={outgoing}
                    nodes={topology.nodes}
                  />
                ) : null}
                {!incoming.length && !outgoing.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {resolveAppMessage(
                      "pages.assessmentFlow.graph.unavailable" as never,
                    )}
                  </p>
                ) : null}
              </section>
              <section className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <h4 className="text-sm font-semibold">
                  {resolveAppMessage(
                    "pages.assessmentFlow.graph.provenance" as never,
                  )}
                </h4>
                {selectedSource ? (
                  <SourceTrace source={selectedSource} />
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {resolveAppMessage(
                      "pages.assessmentFlow.graph.unavailable" as never,
                    )}
                  </p>
                )}
              </section>
            </>
          ) : (
            <EvidenceOverview detail={detail} />
          )}
        </aside>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 px-6 py-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex shrink-0 items-center gap-1">
            <span className="font-medium text-foreground">
              {resolveAppMessage(
                "pages.assessmentFlow.graph.legendLabel" as never,
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="inline-block size-2 rounded-full border border-border" />
            {resolveAppMessage(
              "pages.assessmentFlow.graph.legendNode" as never,
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span aria-hidden="true">─</span>
            {resolveAppMessage(
              "pages.assessmentFlow.graph.legendRelationship" as never,
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-brand" />
            {resolveAppMessage(
              "pages.assessmentFlow.graph.legendInspected" as never,
            )}
          </span>
          <span className="truncate">
            {resolveAppMessage(
              "pages.assessmentFlow.graph.pinnedNote" as never,
            )}
          </span>
        </div>
        {target.kind === ARTIFACT_OPEN_KINDS.internal ||
        target.kind === ARTIFACT_OPEN_KINDS.download ? (
          <Link
            className="shrink-0 rounded-md border border-border/70 px-3 py-1.5 font-medium text-primary hover:bg-muted"
            href={target.href}
          >
            {resolveAppMessage(
              "pages.assessmentFlow.graph.openArtifacts" as never,
            )}
          </Link>
        ) : null}
      </footer>
    </div>
  );
}

function EvidenceOverview({ detail }: { detail: ProgramEvidenceGraphDetail }) {
  return (
    <div>
      <h3 className="text-base font-semibold">
        {resolveAppMessage(
          "pages.assessmentFlow.graph.evidenceOverview" as never,
        )}
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        {resolveAppMessage("pages.assessmentFlow.graph.noSelection" as never)}
      </p>
      <section className="mt-5 border-t border-border/60 pt-4">
        <h4 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.claims" as never)}
        </h4>
        {detail.claims.length ? (
          <div className="mt-3 space-y-2">
            {detail.claims.map((claim) => (
              <div
                className="rounded-md border border-border/60 p-2"
                key={claim.id}
              >
                <p className="break-words text-xs">{claim.meaning}</p>
                {claim.file ? (
                  <p className="mt-1 break-words text-[0.6875rem] text-muted-foreground">
                    {claim.symbol ? `${claim.symbol} · ` : ""}
                    {claim.file}
                    {claim.line ? `:${claim.line}` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {resolveAppMessage(
              "pages.assessmentFlow.graph.noGovernedClaims" as never,
            )}
          </p>
        )}
      </section>
      <section className="mt-5 border-t border-border/60 pt-4">
        <h4 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.provenance" as never)}
        </h4>
        <p className="mt-2 text-xs text-muted-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.graph.noOverviewProvenance" as never,
          )}
        </p>
      </section>
    </div>
  );
}

function formatNodeCaption(node: GraphNode) {
  return `${formatAiUsageRole(node)} · ${formatResolutionState(
    node.resolution_state,
  )}`;
}

function formatEvidenceStatus(node: GraphNode | GraphEdge) {
  const parts = [
    node.evidence_state ? formatEvidenceState(node.evidence_state) : null,
    node.resolution_state ? formatResolutionState(node.resolution_state) : null,
  ].filter(Boolean);
  return parts.length
    ? parts.join(" · ")
    : resolveAppMessage("pages.assessmentFlow.graph.unavailable" as never);
}

function formatAiUsageRole(node: GraphNode) {
  const role = node.ai_usage_role ?? "";
  const suffix =
    AI_USAGE_ROLE_MESSAGE_KEYS[role as keyof typeof AI_USAGE_ROLE_MESSAGE_KEYS];
  return suffix
    ? resolveAppMessage(
        `pages.assessmentFlow.graph.aiUsageRoles.${suffix}` as never,
      )
    : node.kind;
}

function formatEvidenceState(state: string) {
  switch (state) {
    case AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.evidenceStates.confirmedAiCall" as never,
      );
    case AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.evidenceStates.possibleAiCall" as never,
      );
    case AI_DISCOVERY_EVIDENCE_STATES.aiProviderReference:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.evidenceStates.aiProviderReference" as never,
      );
    case AI_DISCOVERY_EVIDENCE_STATES.unresolvedDynamic:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.evidenceStates.unresolvedDynamic" as never,
      );
    default:
      return state;
  }
}

function formatResolutionState(state: string | null | undefined) {
  switch (state) {
    case AI_DISCOVERY_RESOLUTION_STATES.observed:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.resolutionStates.observed" as never,
      );
    case AI_DISCOVERY_RESOLUTION_STATES.corroborated:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.resolutionStates.corroborated" as never,
      );
    case AI_DISCOVERY_RESOLUTION_STATES.inferred:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.resolutionStates.inferred" as never,
      );
    case AI_DISCOVERY_RESOLUTION_STATES.unresolved:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.resolutionStates.unresolved" as never,
      );
    default:
      return resolveAppMessage(
        "pages.assessmentFlow.graph.unavailable" as never,
      );
  }
}

function RelationshipList({
  title,
  edges,
  nodes,
  incoming = false,
}: {
  title: string;
  edges: ProgramEvidenceGraphDetail["paths"]["edges"];
  nodes: ProgramEvidenceGraphDetail["paths"]["nodes"];
  incoming?: boolean;
}) {
  return (
    <section className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <ul className="mt-2 space-y-1 text-xs">
        {edges.map((edge) => {
          const node = nodes.find(
            (candidate) =>
              candidate.id === (incoming ? edge.source : edge.target),
          );
          return (
            <li className="break-words" key={edge.id}>
              <p>
                {node?.label ?? "--"}{" "}
                <span className="text-muted-foreground">
                  {incoming
                    ? `← ${edge.relationship}`
                    : `→ ${edge.relationship}`}
                </span>
              </p>
              <p className="mt-0.5 text-[0.625rem] text-muted-foreground">
                {formatEvidenceStatus(edge)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GraphDetail({
  assessmentId,
  detail,
}: {
  assessmentId: string;
  detail: ProgramEvidenceGraphDetail;
}) {
  const paths: Array<{
    nodes: ProgramEvidenceGraphDetail["paths"]["nodes"];
    edges: ProgramEvidenceGraphDetail["paths"]["edges"];
  }> = [];
  const artifactsTarget = buildArtifactOpenTarget({
    assessmentId,
    type: ARTIFACT_TYPES.programEvidenceGraph,
  });
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <p className="text-xs font-semibold text-muted-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.graph.repositorySnapshot" as never,
          )}
        </p>
        <p className="mt-2 text-base font-semibold">
          {detail.repository.repository_full_name ?? "—"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail.repository.branch ?? detail.repository.ref ?? "—"} ·{" "}
          {detail.repository.pinned_commit ?? "—"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {detail.repository.status ??
            resolveAppMessage(
              "pages.assessmentFlow.graph.unavailable" as never,
            )}
        </p>
      </section>
      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.overview" as never)}
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {(
            [
              ["modulesAnalyzed", detail.overview.modules_analyzed],
              ["codeSymbolsIndexed", detail.overview.code_symbols_indexed],
              ["aiModelInvocations", detail.overview.ai_model_invocations],
              ["evidenceMappedScope", detail.overview.evidence_mapped_scope],
            ] as const
          ).map(([key, value]) => (
            <div className="rounded-lg border border-border/60 p-3" key={key}>
              <dt className="text-xs text-muted-foreground">
                {resolveAppMessage(
                  `pages.assessmentFlow.graph.${key}` as never,
                )}
              </dt>
              <dd className="mt-1 text-lg font-semibold">
                {value == null
                  ? resolveAppMessage(
                      "pages.assessmentFlow.graph.unavailableValue" as never,
                    )
                  : formatProgramEvidenceMetric({
                      value,
                      format: PROGRAM_EVIDENCE_OVERVIEW_FORMATS[key],
                    })}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.pathMap" as never)}
        </h3>
        <div className="mt-3 space-y-4">
          {paths.length ? (
            paths.map((path, pathIndex) => (
              <div className="space-y-2" key={`path-${pathIndex}`}>
                {path.nodes.map((node, index) => (
                  <div key={node.id}>
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="break-words text-xs font-medium">
                        {node.label}
                      </p>
                      <p className="break-words text-[0.6875rem] text-muted-foreground">
                        {node.kind}
                        {node.file
                          ? ` · ${node.file}${node.line ? `:${node.line}` : ""}`
                          : ""}
                      </p>
                    </div>
                    {path.edges[index] ? (
                      <div className="flex items-center gap-2 px-3 py-1 text-[0.6875rem] text-muted-foreground">
                        <span
                          className="h-3 w-px bg-border"
                          aria-hidden="true"
                        />
                        <span className="break-words">
                          {path.edges[index].relationship}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.assessmentFlow.graph.unavailable" as never,
              )}
            </p>
          )}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.claims" as never)}
        </h3>
        {detail.claims.length ? (
          <div className="mt-3 space-y-2">
            {detail.claims.map((claim) => (
              <div
                className="rounded-lg border border-border/60 p-3"
                key={claim.id}
              >
                <p className="text-xs">{claim.meaning}</p>
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  {claim.symbol ?? "—"}
                  {claim.file
                    ? ` · ${claim.file}${claim.line ? `:${claim.line}` : ""}`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {resolveAppMessage("pages.assessmentFlow.graph.noClaims" as never)}
          </p>
        )}
      </section>
      <section className="border-t border-border/60 pt-4">
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.assessmentFlow.graph.provenance" as never)}
        </h3>
        {detail.provenance.finding ? (
          <div className="mt-3 rounded-lg border border-border/60 p-3">
            <p className="text-[0.6875rem] font-semibold text-muted-foreground">
              {resolveAppMessage("pages.assessmentFlow.graph.finding" as never)}
            </p>
            <p className="mt-1 break-words text-xs">
              {detail.provenance.finding.meaning}
            </p>
            {detail.provenance.finding.source ? (
              <SourceTrace source={detail.provenance.finding.source} />
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 rounded-lg border border-border/60 p-3">
          <p className="text-[0.6875rem] font-semibold text-muted-foreground">
            {resolveAppMessage(
              "pages.assessmentFlow.graph.evidenceSource" as never,
            )}
          </p>
          {detail.provenance.source ? (
            <SourceTrace source={detail.provenance.source} />
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.assessmentFlow.graph.unavailable" as never,
              )}
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">
            {resolveAppMessage("pages.assessmentFlow.graph.generated" as never)}
            :
          </span>{" "}
          {new Date(detail.provenance.generated_at).toLocaleString()}
        </p>
        {artifactsTarget.kind === ARTIFACT_OPEN_KINDS.internal ||
        artifactsTarget.kind === ARTIFACT_OPEN_KINDS.download ? (
          <Link
            className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
            href={artifactsTarget.href}
          >
            {resolveAppMessage(
              "pages.assessmentFlow.graph.openArtifacts" as never,
            )}
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function SourceTrace({
  source,
}: {
  source: NonNullable<ProgramEvidenceGraphDetail["provenance"]["source"]>;
}) {
  const location = source.file
    ? `${source.file}${source.start_line ? `:${source.start_line}${source.end_line && source.end_line !== source.start_line ? `–${source.end_line}` : ""}` : ""}`
    : null;
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      {source.symbol ? (
        <p className="break-words font-medium text-foreground">
          {source.symbol}
        </p>
      ) : null}
      {location ? <p className="break-words">{location}</p> : null}
    </div>
  );
}

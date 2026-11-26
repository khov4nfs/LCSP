"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { RequestDetail } from "@/components/molecules/request-detail";
import { ResponseForm } from "@/components/molecules/response-form";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StructuredAnswerControl } from "@/features/assessment-runtime/components/molecules/structured-answer-control";
import { useStructuredAnswerSubmit } from "@/features/assessment-runtime/hooks/use-structured-answer-submit";
import { structuredAnswerMode } from "@/features/assessment-runtime/utils/structured-answer-mode";
import {
  useAssessmentDetailQuery,
  useHumanRequestsQuery,
} from "@/lib/api/assessment-domain-queries";
import { useCustomerTrackingOverviewQuery } from "@/lib/api/tracking-queries";
import { appLocale } from "@/lib/locale";

import { trackingMessage } from "../../utils/tracking-display";
import { RequestCard } from "../molecules/request-card";
import { TrackingError } from "../molecules/tracking-error";
import {
  InformationRequestList,
  REQUEST_STATUS_FILTERS,
  type InformationRequestRow,
  type RequestStatusFilter,
} from "./information-request-list";
import { TrackingCompliancePage } from "./tracking-compliance-page";

const PAGE_LIMIT = 10;

const DASHBOARD_TABS = {
  requests: "requests",
  obligations: "obligations",
} as const;

type DashboardTab = (typeof DASHBOARD_TABS)[keyof typeof DASHBOARD_TABS];

/**
 * Business purpose: Render the Customer Follow-up Requests dashboard (Figma Frame 24 `1662:2162`) with action-first queue, KPI strip, filterable table, and inline response modal.
 * Business rules:
 * - Reads authoritative open requests from `useCustomerTrackingOverviewQuery`.
 * - Submitting an answer inside the modal uses M06's `useStructuredAnswerSubmit` and invalidates tracking caches on completion.
 * - Preserves access to the Legal obligations breakdown (`TrackingCompliancePage`) via a clean tab toggle on `/workspace/compliance`.
 * Execution flow:
 * 1. Load tracking overview data.
 * 2. Compute KPI counts (`Open requests`, `Answered`, `Total requests`, `Affected assessments`) and filterable rows.
 * 3. Render `RequestCard` for the top priority open request and `InformationRequestList` for the queue.
 * 4. Open `RequestDetailDialog` when answering or inspecting a row.
 * Failure cases:
 * - Query errors display `TrackingError` with retry; empty state renders when no requests match.
 * Side effects:
 * - Fetches tracking overview and selected assessment human requests; mutates request answers via `useStructuredAnswerSubmit`.
 */
export function InformationRequestsDashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>(
    DASHBOARD_TABS.requests,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>(
    REQUEST_STATUS_FILTERS.all,
  );
  const [offset, setOffset] = useState(0);
  const [selectedRow, setSelectedRow] = useState<InformationRequestRow | null>(
    null,
  );

  const overviewQuery = useCustomerTrackingOverviewQuery("", 0);
  const overview = overviewQuery.data;

  const allRows: InformationRequestRow[] = useMemo(() => {
    if (!overview) return [];
    return overview.actions.map((item) => ({
      requestId: item.requestId,
      assessmentId: item.assessmentId,
      assessmentName: item.assessmentName,
      assessmentRuleId: item.assessmentRuleId,
      question: item.question,
      unresolvedFact: item.unresolvedFact,
      createdAt: item.createdAt,
      open: true,
      destinationUrl: item.destinationUrl,
    }));
  }, [overview]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (statusFilter === REQUEST_STATUS_FILTERS.open && !row.open) {
        return false;
      }
      if (statusFilter === REQUEST_STATUS_FILTERS.resolved && row.open) {
        return false;
      }
      if (!query) return true;
      return (
        row.question.toLowerCase().includes(query) ||
        row.unresolvedFact.toLowerCase().includes(query) ||
        row.assessmentName.toLowerCase().includes(query)
      );
    });
  }, [allRows, search, statusFilter]);

  const pagedRows = filteredRows.slice(offset, offset + PAGE_LIMIT);
  const topOpenRequest = allRows.find((row) => row.open) ?? null;

  const openRequestsCount =
    overview?.actionsPagination?.total ?? allRows.length;
  const affectedAssessmentsCount = new Set(
    allRows.filter((row) => row.open).map((row) => row.assessmentId),
  ).size;
  const answeredCount = 0;
  const totalRequestsCount = openRequestsCount + answeredCount;

  if (activeTab === DASHBOARD_TABS.obligations) {
    return (
      <div className="flex flex-col">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 pt-6 lg:px-6">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(DASHBOARD_TABS.requests)}
            >
              {trackingMessage("requestsTabRequests")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActiveTab(DASHBOARD_TABS.obligations)}
            >
              {trackingMessage("requestsTabObligations")}
            </Button>
          </div>
        </div>
        <TrackingCompliancePage />
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {trackingMessage("requestsPageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {trackingMessage("requestsPageSubtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActiveTab(DASHBOARD_TABS.requests)}
            >
              {trackingMessage("requestsTabRequests")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(DASHBOARD_TABS.obligations)}
            >
              {trackingMessage("requestsTabObligations")}
            </Button>
          </div>

          <Button
            render={<Link href="/assessments" />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            {trackingMessage("requestsAllAssessments")}
          </Button>
        </div>
      </header>

      <section
        aria-label={trackingMessage("requestsPageTitle")}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr]"
      >
        <NextMetricCard
          label={trackingMessage("openRequestsMetricLabel")}
          value={openRequestsCount.toLocaleString(appLocale)}
          context={trackingMessage("openRequestsMetricContext")}
          variant={NEXT_METRIC_VARIANTS.attention}
        />
        <NextMetricCard
          label={trackingMessage("requestsAnsweredMetricLabel")}
          value={answeredCount.toLocaleString(appLocale)}
          context={trackingMessage("requestsAnsweredMetricContext")}
        />
        <NextMetricCard
          label={trackingMessage("requestsTotalMetricLabel")}
          value={totalRequestsCount.toLocaleString(appLocale)}
          context={trackingMessage("requestsTotalMetricContext")}
        />
        <NextMetricCard
          label={trackingMessage("requestsAffectedMetricLabel")}
          value={affectedAssessmentsCount.toLocaleString(appLocale)}
          context={trackingMessage("requestsAffectedMetricContext")}
        />
      </section>

      {overviewQuery.isError ? (
        <TrackingError onRetry={() => void overviewQuery.refetch()} />
      ) : null}

      {overviewQuery.isPending ? <Skeleton className="h-72" /> : null}

      {!overviewQuery.isPending && !overviewQuery.isError ? (
        <>
          {topOpenRequest ? (
            <RequestCard
              title={topOpenRequest.question}
              subtitle={`${topOpenRequest.assessmentName} · ${topOpenRequest.unresolvedFact}`}
              onAnswer={() => setSelectedRow(topOpenRequest)}
            />
          ) : null}

          <InformationRequestList
            rows={pagedRows}
            totalCount={filteredRows.length}
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            statusFilter={statusFilter}
            onStatusFilterChange={(value) => {
              setStatusFilter(value);
              setOffset(0);
            }}
            onViewAll={() => {
              setSearch("");
              setStatusFilter(REQUEST_STATUS_FILTERS.all);
              setOffset(0);
            }}
            offset={offset}
            limit={PAGE_LIMIT}
            onPageChange={setOffset}
            onSelectRequest={(row) => setSelectedRow(row)}
          />
        </>
      ) : null}

      {selectedRow ? (
        <RequestDetailDialog
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </main>
  );
}

/**
 * Business purpose: Display the shared `RequestDetail` and `ResponseForm` inside a modal for an individually selected request on Frame 24.
 * Business rules:
 * - Loads authoritative `AssessmentHumanRequestView` and `caseRevision` from the assessment's endpoints before allowing inline submission.
 * - Invalidates tracking overview queries after successful submission so the queue updates immediately.
 * Execution flow:
 * 1. Fetch `useHumanRequestsQuery` and `useAssessmentDetailQuery` for the selected assessment.
 * 2. Render `RequestDetail` and, when open, `ResponseForm` + `StructuredAnswerControl`.
 * Failure cases:
 * - Loading or missing structured controls falls back to an `Open in assessment` link.
 * Side effects:
 * - Calls `useStructuredAnswerSubmit` and invalidates `trackingKeys.all`.
 */
function RequestDetailDialog({
  row,
  onClose,
}: {
  row: InformationRequestRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const requestsQuery = useHumanRequestsQuery(row.assessmentId);
  const detailQuery = useAssessmentDetailQuery(row.assessmentId);

  const matchingRequest = requestsQuery.data?.requests.find(
    (item) => item.requestId === row.requestId,
  );
  const caseRevision =
    requestsQuery.data?.caseRevision ?? detailQuery.data?.case?.caseRevision;

  const answerSubmit = useStructuredAnswerSubmit(
    row.assessmentId,
    matchingRequest,
    caseRevision,
  );

  const isOpen = matchingRequest
    ? matchingRequest.status.toLowerCase() === "open"
    : row.open;

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{trackingMessage("requestsDetailTitle")}</DialogTitle>
        </DialogHeader>

        {requestsQuery.isPending ? (
          <p className="py-4 text-sm text-muted-foreground" role="status">
            {trackingMessage("requestsLoadingDetail")}
          </p>
        ) : (
          <div className="space-y-4">
            <RequestDetail
              question={matchingRequest?.question ?? row.question}
              open={isOpen}
              assessmentName={row.assessmentName}
              assessmentHref={`/assessments/${encodeURIComponent(row.assessmentId)}?requestId=${encodeURIComponent(row.requestId)}`}
              unresolvedFact={
                matchingRequest?.unresolvedFact ?? row.unresolvedFact
              }
              decisionImpact={matchingRequest?.decisionImpact}
              resolutionAttempts={matchingRequest?.resolutionAttempts}
              defaultExpanded
            />

            {matchingRequest && isOpen && caseRevision !== undefined ? (
              <ResponseForm
                failed={answerSubmit.failedRequestId === matchingRequest.requestId}
                staleConflict={
                  answerSubmit.staleConflictRequestId ===
                  matchingRequest.requestId
                }
              >
                <StructuredAnswerControl
                  mode={structuredAnswerMode(matchingRequest)}
                  choices={matchingRequest.choices}
                  idBase={`dashboard-answer-${matchingRequest.requestId}`}
                  pending={
                    answerSubmit.submittingRequestId ===
                    matchingRequest.requestId
                  }
                  failed={
                    answerSubmit.failedRequestId === matchingRequest.requestId
                  }
                  staleConflict={
                    answerSubmit.staleConflictRequestId ===
                    matchingRequest.requestId
                  }
                  onSubmit={async (answer) => {
                    await answerSubmit.submit(answer, matchingRequest);
                    await queryClient.invalidateQueries({
                      queryKey: ["tracking"],
                    });
                  }}
                />
              </ResponseForm>
            ) : (
              <p className="text-xs text-muted-foreground">
                {trackingMessage("requestsNoStructuredControl")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { DOCUMENT_REQUEST_STATUSES } from "@lcsp/contracts/document";
import {
  LEGACY_ARTIFACT_RECONCILIATION_REASONS,
  LEGACY_OUTBOX_DISPOSITIONS,
} from "@lcsp/contracts/legacy-migration";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { classifyLegacyReportReference } from "../../../domain/legacy-report-classification.js";
import { parseLegacyReportReference } from "../../../domain/legacy-report-reference.js";
import { classifyOutboxEventType } from "../../../domain/legacy-outbox-classification.js";
import { IN_FLIGHT_CLOSURE_RULES } from "../../../infrastructure/persistence/legacy-archive-registry.js";
import { LegacyValidationRepository } from "../../../infrastructure/persistence/legacy-validation.repository.js";
import { buildLegacyReportPolicy } from "../../services/legacy-report-policy.js";
import {
  PreflightLegacyMigrationQuery,
  type PreflightReport,
} from "./preflight-legacy-migration.query.js";

@QueryHandler(PreflightLegacyMigrationQuery)
export class PreflightLegacyMigrationHandler implements IQueryHandler<PreflightLegacyMigrationQuery> {
  constructor(private readonly validation: LegacyValidationRepository) {}

  async execute(
    query: PreflightLegacyMigrationQuery,
  ): Promise<PreflightReport> {
    const [portfolio, counts, byStatus, outbox, reservations] =
      await Promise.all([
        this.validation.activePortfolio(),
        this.validation.assessmentCounts(),
        this.validation.assessmentsByLegacyStatus(),
        this.validation.undeliveredOutbox(),
        this.validation.unsettledV1Reservations(),
      ]);
    const inFlight: Record<string, number> = {};
    for (const rule of IN_FLIGHT_CLOSURE_RULES)
      inFlight[rule.source] = await this.validation.inFlightCount(rule);

    const undelivered = outbox.map((row) => ({
      eventType: row.eventType,
      status: row.status,
      count: Number(row.n),
      disposition: classifyOutboxEventType(row.eventType),
    }));
    const sumFor = (disposition: string) =>
      undelivered
        .filter((row) => row.disposition === disposition)
        .reduce((total, row) => total + row.count, 0);

    const references = await this.reportReferences(query);
    const blockers: string[] = [];
    if (Object.keys(references.unresolvedHosts).length > 0)
      blockers.push("UNRESOLVED_REPORT_LOCATIONS");
    if (portfolio.activeCount !== 1 || portfolio.engineeringRuleCount === 0)
      blockers.push("NO_ACTIVE_LEGAL_PORTFOLIO");
    if (Number(reservations.n) > 0)
      blockers.push("UNSETTLED_V1_BILLING_RESERVATIONS");

    return {
      generatedAt: new Date().toISOString(),
      activePortfolio: portfolio,
      assessments: {
        total: Number(counts.total),
        terminal: Number(counts.terminal),
        nonTerminal: Number(counts.non_terminal),
        alreadyV2: Number(counts.already_v2),
      },
      assessmentsByLegacyStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, Number(row.n)]),
      ),
      outbox: {
        undelivered,
        legacyUndelivered: sumFor(LEGACY_OUTBOX_DISPOSITIONS.CANCEL),
        unclassifiedUndelivered: sumFor(
          LEGACY_OUTBOX_DISPOSITIONS.UNCLASSIFIED,
        ),
      },
      inFlight,
      reportReferences: references,
      unsettledV1Reservations: {
        count: Number(reservations.n),
        credits: reservations.credits,
      },
      blockers,
    };
  }

  /**
   * Classifies every stored report reference WITHOUT touching its location. A reference that points
   * at a location nobody configured or attested would be archived as an immutable orphan, so the
   * operator must resolve it before the archive runs.
   */
  private async reportReferences(query: PreflightLegacyMigrationQuery) {
    const policy = buildLegacyReportPolicy(query.report);
    const byOutcome: Record<string, number> = {};
    const unresolvedHosts: Record<string, number> = {};
    let total = 0;
    let after = "";
    for (;;) {
      const page = await this.validation.documentReferences(after, 1000);
      if (page.length === 0) break;
      for (const row of page) {
        total += 1;
        const reference = parseLegacyReportReference(row.documentUrl);
        const outcome = classifyLegacyReportReference(
          reference,
          row.status === DOCUMENT_REQUEST_STATUSES.ready,
          policy,
        );
        const key = outcome
          ? `${outcome.reconciliationClass}/${outcome.reconciliationReason}`
          : "READ_REQUIRED";
        byOutcome[key] = (byOutcome[key] ?? 0) + 1;
        if (
          outcome?.reconciliationReason ===
          LEGACY_ARTIFACT_RECONCILIATION_REASONS.LOCATION_NOT_CONFIGURED
        ) {
          const host =
            reference.kind === "HTTP"
              ? reference.host
              : reference.kind === "FILE"
                ? "file:"
                : "unknown";
          unresolvedHosts[host] = (unresolvedHosts[host] ?? 0) + 1;
        }
      }
      after = page[page.length - 1].id;
    }
    return { total, byOutcome, unresolvedHosts };
  }
}

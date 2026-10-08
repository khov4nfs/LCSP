import { Query } from "@nestjs/cqrs";

import type { LegacyReportPolicyOptions } from "../../legacy-migration.types.js";

import type { PortfolioFacts } from "../../../infrastructure/persistence/legacy-validation.repository.js";

export type PreflightReport = {
  generatedAt: string;
  activePortfolio: PortfolioFacts;
  assessments: {
    total: number;
    terminal: number;
    nonTerminal: number;
    alreadyV2: number;
  };
  assessmentsByLegacyStatus: Record<string, number>;
  outbox: {
    undelivered: {
      eventType: string;
      status: string;
      count: number;
      disposition: string;
    }[];
    legacyUndelivered: number;
    unclassifiedUndelivered: number;
  };
  inFlight: Record<string, number>;
  unsettledV1Reservations: { count: number; credits: string };
  /** Report references grouped by what the supplied policy can do with them (no I/O performed). */
  reportReferences: {
    total: number;
    byOutcome: Record<string, number>;
    unresolvedHosts: Record<string, number>;
  };
  /** Read-only: stable codes that must be cleared before a cutover run. */
  blockers: string[];
};

export class PreflightLegacyMigrationQuery extends Query<PreflightReport> {
  constructor(public readonly report: LegacyReportPolicyOptions) {
    super();
  }
}

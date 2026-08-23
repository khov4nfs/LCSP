#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(resolve(rootDir, "apps/api/package.json"));
const { PrismaClient } = apiRequire("@prisma/client");
const { PrismaPg } = apiRequire("@prisma/adapter-pg");
const amqp = apiRequire("amqplib");

const ASSESSMENT_WORKER_QUEUES = [
  "intelligence.evidence-accepted",
  "investigation.evidence-accepted",
  "legal.legal-matching-requested",
  "classification.legal-rule-match-ready",
];

const WORKER_RETRY_DELAYS_SECONDS = [30, 120, 600];

function usage() {
  console.error(
    [
      "Usage: pnpm delete:assessment -- <assessmentId> [--yes] [--force-production]",
      "",
      "Deletes assessment-scoped LCSP domain data.",
      "",
      "Options:",
      "  --yes                Execute deletion. Without this flag, runs a dry-run.",
      "  --force-production   Allow execution when NODE_ENV=production.",
      "  --purge-worker-retries",
      "                       Also purge assessment pipeline worker queues and retry queues.",
      "                       This is queue-wide, not assessment-scoped; use only for local/dev cleanup.",
      "",
      "Environment:",
      "  DATABASE_URL must point to the target Postgres database.",
      "  RABBITMQ_URL is required when --purge-worker-retries is used.",
    ].join("\n"),
  );
}

function loadDotEnv() {
  const envPath = resolve(rootDir, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    if (process.env[key] !== undefined) {
      continue;
    }
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseArgs(argv) {
  const options = {
    assessmentId: "",
    execute: false,
    forceProduction: false,
    purgeWorkerRetries: false,
  };

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--yes") {
      options.execute = true;
      continue;
    }
    if (arg === "--force-production") {
      options.forceProduction = true;
      continue;
    }
    if (arg === "--purge-worker-retries") {
      options.purgeWorkerRetries = true;
      continue;
    }
    if (arg.startsWith("--assessment-id=")) {
      options.assessmentId = arg.slice("--assessment-id=".length);
      continue;
    }
    if (!options.assessmentId) {
      options.assessmentId = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!options.assessmentId.trim()) {
    throw new Error("assessmentId is required");
  }

  return {
    ...options,
    assessmentId: options.assessmentId.trim(),
  };
}

async function main() {
  loadDotEnv();

  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (
    process.env.NODE_ENV === "production" &&
    options.execute &&
    !options.forceProduction
  ) {
    throw new Error(
      "Refusing to delete in NODE_ENV=production without --force-production",
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
  try {
    const summary = options.execute
      ? await deleteAssessmentData(prisma, options.assessmentId)
      : await previewAssessmentData(prisma, options.assessmentId);

    printSummary(summary, options.execute);
    if (options.execute && options.purgeWorkerRetries) {
      const purged = await purgeWorkerRetryQueues();
      printQueueSummary(purged);
    } else if (options.execute) {
      printWorkerQueueWarning(options.assessmentId);
    }
    if (!options.execute) {
      console.log("");
      console.log(
        `Dry-run only. Re-run with: pnpm delete:assessment -- ${options.assessmentId} --yes`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function purgeWorkerRetryQueues() {
  const rabbitmqUrl = process.env.RABBITMQ_URL;
  if (!rabbitmqUrl) {
    throw new Error("RABBITMQ_URL is required with --purge-worker-retries");
  }

  const connection = await amqp.connect(rabbitmqUrl);
  try {
    const channel = await connection.createChannel();
    try {
      const queues = ASSESSMENT_WORKER_QUEUES.flatMap((queueName) => [
        queueName,
        ...WORKER_RETRY_DELAYS_SECONDS.map(
          (delaySeconds) => `${queueName}.retry.${delaySeconds}s`,
        ),
      ]);
      const results = [];
      for (const queueName of queues) {
        try {
          const result = await channel.purgeQueue(queueName);
          results.push([queueName, result.messageCount ?? 0]);
        } catch (error) {
          results.push([
            queueName,
            error instanceof Error ? error.message : String(error),
          ]);
        }
      }
      return results;
    } finally {
      await channel.close().catch(() => undefined);
    }
  } finally {
    await connection.close().catch(() => undefined);
  }
}

async function collectRelatedIds(prisma, assessmentId) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, organizationId: true, name: true },
  });
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const [
    wizardProfiles,
    readinessExports,
    snapshots,
    scanJobs,
    reanalysisRequests,
    reanalysisCheckpoints,
    evidenceReports,
    technicalProfiles,
    aiUsageFlows,
    conflicts,
    runtimeEvents,
    verifiedProfiles,
    legalRuleMatches,
    classificationResults,
    reviewRequests,
    documentRequests,
    installStates,
    repositoryConnections,
  ] = await Promise.all([
    prisma.wizardProfile.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.readinessExport.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.repositorySnapshot.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.repositoryScanJob.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.targetedReanalysisRequest.findMany({
      where: { assessmentId },
      select: { id: true, checkpointRef: true },
    }),
    prisma.targetedReanalysisCheckpoint.findMany({
      where: { request: { assessmentId } },
      select: { id: true },
    }),
    prisma.technicalEvidenceReport.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.technicalProfile.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.aIUsageFlow.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.conflictRecord.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.assessmentRuntimeEvent.findMany({
      where: { assessmentId },
      select: { id: true, runId: true },
    }),
    prisma.verifiedProfile.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.legalRuleMatch.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.classificationResult.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.classificationReviewRequest.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.documentRequest.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.gitHubAppInstallState.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
    prisma.repositoryConnection.findMany({
      where: { assessmentId },
      select: { id: true },
    }),
  ]);

  const ids = new Set([assessment.id]);
  const addIds = (rows, key = "id") => {
    for (const row of rows) {
      if (row[key]) {
        ids.add(row[key]);
      }
    }
  };

  for (const rows of [
    wizardProfiles,
    readinessExports,
    snapshots,
    scanJobs,
    evidenceReports,
    technicalProfiles,
    aiUsageFlows,
    conflicts,
    runtimeEvents,
    verifiedProfiles,
    legalRuleMatches,
    classificationResults,
    reviewRequests,
    documentRequests,
    installStates,
  ]) {
    addIds(rows);
  }
  addIds(reanalysisRequests);
  addIds(reanalysisRequests, "checkpointRef");
  addIds(reanalysisCheckpoints);
  addIds(runtimeEvents, "runId");

  return {
    assessment,
    ids: [...ids],
    repositoryConnectionIds: repositoryConnections.map((row) => row.id),
  };
}

function deletionSteps(assessmentId, relatedIds, repositoryConnectionIds) {
  return [
    [
      "OutboxMessage",
      (tx) =>
        tx.outboxMessage.deleteMany({
          where: { aggregateId: { in: relatedIds } },
        }),
    ],
    [
      "AuthAuditEvent",
      (tx) =>
        tx.authAuditEvent.deleteMany({
          where: { resourceId: { in: relatedIds } },
        }),
    ],
    [
      "AuthDecisionLog",
      (tx) =>
        tx.authDecisionLog.deleteMany({
          where: { resourceId: { in: relatedIds } },
        }),
    ],
    [
      "DocumentRequest",
      (tx) => tx.documentRequest.deleteMany({ where: { assessmentId } }),
    ],
    [
      "ClassificationReviewRequest",
      (tx) =>
        tx.classificationReviewRequest.deleteMany({ where: { assessmentId } }),
    ],
    [
      "ClassificationResult",
      (tx) => tx.classificationResult.deleteMany({ where: { assessmentId } }),
    ],
    [
      "LegalRuleMatch",
      (tx) => tx.legalRuleMatch.deleteMany({ where: { assessmentId } }),
    ],
    [
      "VerifiedProfile",
      (tx) => tx.verifiedProfile.deleteMany({ where: { assessmentId } }),
    ],
    [
      "ConflictRecord",
      (tx) => tx.conflictRecord.deleteMany({ where: { assessmentId } }),
    ],
    [
      "AIUsageFlow",
      (tx) => tx.aIUsageFlow.deleteMany({ where: { assessmentId } }),
    ],
    [
      "TechnicalProfile",
      (tx) => tx.technicalProfile.deleteMany({ where: { assessmentId } }),
    ],
    [
      "TargetedReanalysisCheckpoint",
      (tx) =>
        tx.targetedReanalysisCheckpoint.deleteMany({
          where: { request: { assessmentId } },
        }),
    ],
    [
      "TargetedReanalysisRequest",
      (tx) =>
        tx.targetedReanalysisRequest.deleteMany({ where: { assessmentId } }),
    ],
    [
      "TechnicalEvidenceReport",
      (tx) =>
        tx.technicalEvidenceReport.deleteMany({ where: { assessmentId } }),
    ],
    [
      "AssessmentRuntimeEvent",
      (tx) => tx.assessmentRuntimeEvent.deleteMany({ where: { assessmentId } }),
    ],
    [
      "RepositoryScanJob",
      (tx) => tx.repositoryScanJob.deleteMany({ where: { assessmentId } }),
    ],
    [
      "RepositorySnapshot",
      (tx) => tx.repositorySnapshot.deleteMany({ where: { assessmentId } }),
    ],
    [
      "GitHubAppInstallState",
      (tx) => tx.gitHubAppInstallState.deleteMany({ where: { assessmentId } }),
    ],
    [
      "RepositoryConnection.assessmentId",
      (tx) =>
        tx.repositoryConnection.updateMany({
          where: { id: { in: repositoryConnectionIds } },
          data: { assessmentId: null },
        }),
    ],
    [
      "ReadinessExport",
      (tx) => tx.readinessExport.deleteMany({ where: { assessmentId } }),
    ],
    [
      "WizardProfile",
      (tx) => tx.wizardProfile.deleteMany({ where: { assessmentId } }),
    ],
    [
      "Assessment",
      (tx) => tx.assessment.deleteMany({ where: { id: assessmentId } }),
    ],
  ];
}

async function previewAssessmentData(prisma, assessmentId) {
  const related = await collectRelatedIds(prisma, assessmentId);
  const counts = [];
  for (const [label, run] of deletionSteps(
    assessmentId,
    related.ids,
    related.repositoryConnectionIds,
  )) {
    const result = await run(countAdapter(prisma));
    counts.push([label, result.count]);
  }
  return { assessment: related.assessment, counts };
}

async function deleteAssessmentData(prisma, assessmentId) {
  const related = await collectRelatedIds(prisma, assessmentId);
  const counts = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const [label, run] of deletionSteps(
      assessmentId,
      related.ids,
      related.repositoryConnectionIds,
    )) {
      const result = await run(tx);
      results.push([label, result.count]);
    }
    return results;
  });
  return { assessment: related.assessment, counts };
}

function countAdapter(prisma) {
  return new Proxy(prisma, {
    get(target, prop) {
      const delegate = target[prop];
      if (!delegate || typeof delegate !== "object") {
        return delegate;
      }
      return new Proxy(delegate, {
        get(delegateTarget, delegateProp) {
          if (delegateProp === "deleteMany" || delegateProp === "updateMany") {
            return (args) => delegateTarget.count({ where: args?.where });
          }
          return delegateTarget[delegateProp];
        },
      });
    },
  });
}

function printSummary(summary, executed) {
  const verb = executed ? "Deleted" : "Would delete";
  console.log(
    `${verb} assessment data for ${summary.assessment.id} (${summary.assessment.name})`,
  );
  console.table(
    summary.counts.map(([model, count]) => ({
      model,
      count,
    })),
  );
}

function printQueueSummary(results) {
  console.log("");
  console.log(
    "Purged worker queues. Counts are queue-wide, not assessment-scoped.",
  );
  console.table(
    results.map(([queue, result]) => ({
      queue,
      result,
    })),
  );
}

function printWorkerQueueWarning(assessmentId) {
  console.log("");
  console.log(
    [
      "Database rows were deleted, but already-published RabbitMQ worker messages can still retry.",
      "If workers keep logging 404 for deleted artifacts, stop workers or run:",
      `  pnpm delete:assessment -- ${assessmentId} --yes --purge-worker-retries`,
      "Use that only when it is acceptable to purge the shared assessment pipeline queues.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

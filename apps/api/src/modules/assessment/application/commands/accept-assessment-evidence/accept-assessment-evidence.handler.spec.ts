import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  type AcceptEvidenceRequest,
  type SearchCoverageEvidenceRequest,
} from "@lcsp/contracts/assessment-domain";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import type { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AcceptAssessmentEvidenceHandler } from "./accept-assessment-evidence.handler.js";
import { AcceptAssessmentEvidenceCommand } from "./accept-assessment-evidence.command.js";

const commit = "a".repeat(40);
const source = (path: string): AcceptEvidenceRequest => ({
  type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
  repositoryCommit: commit,
  path,
  startLine: 1,
  endLine: 2,
  excerptSha256: "sha256:" + "b".repeat(64),
});
const coverage = (): SearchCoverageEvidenceRequest => ({
  type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
  repositoryCommit: commit,
  scopes: [
    { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: "chatbot" },
  ],
  queries: [],
  inspectedEntryPoints: ["chatbot/main.py"],
  knownGaps: [],
  directSourceFallbacks: [
    { path: "chatbot/config.py", reason: "Read the scoped configuration" },
  ],
});

function fixture(prefix: string | null, replayed = false) {
  const accepted = {
    evidenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
    state: ASSESSMENT_RECORD_STATES.ACCEPTED,
    contentSha256: "sha256:" + "b".repeat(64),
  };
  const findUnique = jest
    .fn<(args: unknown) => Promise<typeof accepted | null>>()
    .mockResolvedValue(replayed ? accepted : null);
  const create = jest
    .fn<(args: { data: Record<string, unknown> }) => Promise<typeof accepted>>()
    .mockResolvedValue(accepted);
  const tx = { assessmentEvidence: { findUnique, create } };
  const prisma = {
    $transaction: (callback: (t: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaService;
  const authority = {
    authorizeInTx: () => Promise.resolve({ executionId: "execution-1" }),
  } as unknown as AssessmentRuntimeAuthority;
  const support = {
    loadPins: () =>
      Promise.resolve({
        caseRevision: 1,
        repositoryCommit: commit,
        sourcePathPrefix: prefix,
      }),
  } as unknown as AssessmentCaseSupport;
  const appendInTx = jest
    .fn<(tx: unknown, input: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const handler = new AcceptAssessmentEvidenceHandler(
    prisma,
    authority,
    support,
    { appendInTx } as unknown as AssessmentEventAppender,
  );
  const run = (request: AcceptEvidenceRequest) =>
    handler.execute(
      new AcceptAssessmentEvidenceCommand(
        "assessment-1",
        "lease-1",
        request,
        "correlation-1",
      ),
    );
  return { run, findUnique, create, appendInTx };
}

describe("AcceptAssessmentEvidenceHandler immutable source scope", () => {
  it.each([
    "other-project/main.py",
    "chatbot-other/main.py",
    "chatbot/../other/main.py",
    "chatbot/%2e%2e/other/main.py",
    "/chatbot/main.py",
    "chatbot\\main.py",
    "chatbot//main.py",
    "chatbot/./main.py",
    "chatbot/main.py/",
    " chatbot/main.py",
  ])(
    "rejects source path %s before lookup, replay or persistence",
    async (path) => {
      const f = fixture("chatbot", true);
      await expect(f.run(source(path))).rejects.toMatchObject({
        response: {
          problem: {
            code: ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
            status: 422,
          },
        },
      });
      expect(f.findUnique).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
      expect(f.appendInTx).not.toHaveBeenCalled();
    },
  );

  it.each(["scope", "entry", "fallback"])(
    "rejects out-of-scope SEARCH %s before an existing evidence replay",
    async (field) => {
      const request = coverage();
      if (field === "scope") request.scopes[0].path = ".";
      if (field === "entry")
        request.inspectedEntryPoints[0] = "chatbot-other/main.py";
      if (field === "fallback")
        request.directSourceFallbacks[0].path = "other-project/config.py";
      const f = fixture("chatbot", true);
      await expect(f.run(request)).rejects.toMatchObject({
        response: {
          problem: {
            code: ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
          },
        },
      });
      expect(f.findUnique).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it.each(["chatbot%2Fmain.py", "chatbot\\main.py", "./chatbot/main.py", "."])(
    "rejects ambiguous source paths even for whole-repository snapshots: %s",
    async (path) => {
      const f = fixture(null);
      await expect(f.run(source(path))).rejects.toMatchObject({
        response: {
          problem: {
            code: ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
          },
        },
      });
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it("preserves commit rejection before any persistence", async () => {
    const f = fixture("chatbot");
    await expect(
      f.run({ ...source("chatbot/main.py"), repositoryCommit: "c".repeat(40) }),
    ).rejects.toMatchObject({
      response: {
        problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_PIN_MISMATCH },
      },
    });
    expect(f.findUnique).not.toHaveBeenCalled();
  });

  it("accepts a canonical source path within the exact directory boundary", async () => {
    const f = fixture("chatbot");
    await expect(f.run(source("chatbot/main.py"))).resolves.toMatchObject({
      replayed: false,
    });
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { path: "chatbot/main.py", startLine: 1, endLine: 2 },
        }),
      }),
    );
    expect(f.appendInTx).toHaveBeenCalledTimes(1);
  });

  it("keeps valid scoped evidence replay idempotent", async () => {
    const f = fixture("chatbot", true);
    await expect(f.run(source("chatbot/main.py"))).resolves.toMatchObject({
      replayed: true,
    });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.appendInTx).not.toHaveBeenCalled();
  });

  it("accepts scoped SEARCH paths and full-repository root search only with a null prefix", async () => {
    const scoped = fixture("chatbot");
    await scoped.run(coverage());
    expect(scoped.create).toHaveBeenCalledTimes(1);
    const full = fixture(null);
    const request = coverage();
    request.scopes[0].path = ".";
    await full.run(request);
    expect(full.create).toHaveBeenCalledTimes(1);
  });
});

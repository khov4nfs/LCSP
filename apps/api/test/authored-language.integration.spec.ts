import {
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
  jest,
} from "@jest/globals";
import { randomUUID, createHash } from "node:crypto";
import {
  PrismaClient,
  AuthoredSourceLanguage,
  AuthoredLocalizationLocale,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
} from "../src/platform/localization/authored-localization.service.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
  AUTHORED_CANDIDATE_ACTIONS,
  AUTHORED_LANGUAGE_REVIEW_CODES,
} from "@lcsp/contracts/assessment-domain";

const url = process.env.LCSP_TEST_LOCALIZATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

integration("reviewed authored language PostgreSQL workflow", () => {
  let first: PrismaClient, second: PrismaClient;
  let service: AuthoredLocalizationService,
    replica: AuthoredLocalizationService;
  const providerUrl = process.env.LCSP_AUTHORED_TRANSLATION_URL;
  const providerKey = process.env.LCSP_AUTHORED_TRANSLATION_KEY;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== "127.0.0.1" ||
      !target.pathname.includes("lcsp347_localization_test")
    )
      throw new Error("Dedicated disposable localization database required");
    first = new PrismaClient({ adapter: new PrismaPg(url!) });
    second = new PrismaClient({ adapter: new PrismaPg(url!) });
    await Promise.all([first.$connect(), second.$connect()]);
    // This database is dedicated to this suite; retire unfinished work from earlier failed test runs.
    await first.authoredLocalizationRequest.updateMany({
      where: { state: "PENDING" },
      data: { state: "FAILED", leaseToken: null, leaseUntil: null },
    });
    service = new AuthoredLocalizationService(first as PrismaService);
    replica = new AuthoredLocalizationService(second as PrismaService);
    process.env.LCSP_AUTHORED_TRANSLATION_URL =
      "http://isolated-provider.invalid";
    process.env.LCSP_AUTHORED_TRANSLATION_KEY = "isolated-test-only";
  });
  afterAll(async () => {
    if (providerUrl === undefined)
      delete process.env.LCSP_AUTHORED_TRANSLATION_URL;
    else process.env.LCSP_AUTHORED_TRANSLATION_URL = providerUrl;
    if (providerKey === undefined)
      delete process.env.LCSP_AUTHORED_TRANSLATION_KEY;
    else process.env.LCSP_AUTHORED_TRANSLATION_KEY = providerKey;
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });
  async function enqueue(document: Record<string, string>) {
    const scopeId = randomUUID();
    await first.$transaction((tx) =>
      enqueueAuthoredDocument(tx, {
        scopeId,
        entityId: scopeId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
        canonicalRevision: "1",
        document,
      }),
    );
    return {
      scopeId,
      rows: await first.authoredLocalizationRequest.findMany({
        where: { scopeId },
      }),
    };
  }
  beforeEach(async () => {
    await first.authoredLocalizationRequest.updateMany({
      where: { state: AUTHORED_LOCALIZATION_STATES.PENDING },
      data: {
        state: AUTHORED_LOCALIZATION_STATES.FAILED,
        leaseToken: null,
        leaseUntil: null,
      },
    });
  });
  it("rejects unverified writer EN/VI hints instead of treating them as provenance", async () => {
    const scopeId = randomUUID();
    await expect(
      first.$transaction((tx) =>
        enqueueAuthoredDocument(tx, {
          scopeId,
          entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
          entityId: scopeId,
          canonicalRevision: "1",
          document: { summary: "Unverified writer text" },
          sourceLanguages: { "/summary": AuthoredSourceLanguage.EN },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await first.authoredLocalizationRequest.count({ where: { scopeId } }),
    ).toBe(0);
  });

  it("keeps historical null-language READY bytes unavailable until exact output review", async () => {
    const fixture = await enqueue({ summary: "Historical authored content." });
    const job = fixture.rows[0];
    await first.authoredLocalizationRequest.update({
      where: { id: job.id },
      data: {
        state: AUTHORED_LOCALIZATION_STATES.READY,
        originalLanguage: null,
      },
    });
    await first.authoredLocalizedRevision.create({
      data: {
        requestId: job.id,
        content: job.originalContent,
        contentSha256: job.originSha256,
        engine: "legacy-unreviewed",
        engineVersion: "1",
      },
    });
    await expect(
      replica.project(
        [job.originalContent],
        job.locale === AuthoredLocalizationLocale.EN ? "en" : "vi",
        fixture.scopeId,
      ),
    ).rejects.toThrow();
    expect(
      (await service.reviewQueue(fixture.scopeId)).items.find(
        (row) => row.id === job.id,
      )?.sourceLanguage,
    ).toBe(AuthoredSourceLanguage.UNKNOWN);
    await service.reviewOutput(
      fixture.scopeId,
      job.id,
      {
        originSha256: job.originSha256,
        contentSha256: job.originSha256,
        confirmsTargetLanguageAndMeaning: true,
        evidence: "Independent historical output review fixture",
      },
      "historical-reviewer",
    );
    expect(
      (await replica.reviewQueue(fixture.scopeId)).items.find(
        (row) => row.id === job.id,
      )?.originalLanguage,
    ).toBeNull();
    await expect(
      first.authoredLocalizationReview.updateMany({
        where: { requestId: job.id },
        data: { evidence: "Overwritten review" },
      }),
    ).rejects.toThrow();
  });

  it("reconciles a legacy native paraphrase with an append-only exact-copy revision", async () => {
    const fixture = await enqueue({
      summary: "Exact canonical English source.",
    });
    const job = fixture.rows.find(
      (row) => row.locale === AuthoredLocalizationLocale.EN,
    )!;
    const legacyContent = "Historical provider paraphrase.";
    await first.authoredLocalizationRequest.update({
      where: { id: job.id },
      data: { state: AUTHORED_LOCALIZATION_STATES.READY },
    });
    await first.authoredLocalizedRevision.create({
      data: {
        requestId: job.id,
        content: legacyContent,
        contentSha256: hash(legacyContent),
        engine: "legacy-provider",
        engineVersion: "1",
      },
    });
    await service.reviewSource(
      fixture.scopeId,
      job.id,
      {
        sourceLanguage: AuthoredSourceLanguage.EN,
        originSha256: job.originSha256,
        canonicalRevision: "1",
        evidence: "Reviewed historical English source provenance",
      },
      "source-reviewer",
    );
    await expect(
      replica.project([job.originalContent], "en", fixture.scopeId),
    ).rejects.toThrow();
    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("Only the non-native target may need a provider"),
      );
    try {
      await service.drain();
      expect(provider).toHaveBeenCalledTimes(1);
      const latest = await first.authoredLocalizationRequest.findFirstOrThrow({
        where: {
          scopeId: fixture.scopeId,
          locale: AuthoredLocalizationLocale.EN,
        },
        orderBy: { translationRevision: "desc" },
        include: { revision: true },
      });
      expect(latest.translationRevision).toBe(2);
      expect(latest.revision?.content).toBe(job.originalContent);
      expect(latest.revision?.engine).toBe("CANONICAL_ORIGINAL");
      expect(
        (
          await replica.project([job.originalContent], "en", fixture.scopeId)
        ).get(job.originalContent),
      ).toBe(job.originalContent);
      expect(
        (
          await first.authoredLocalizedRevision.findUniqueOrThrow({
            where: { requestId: job.id },
          })
        ).content,
      ).toBe(legacyContent);
    } finally {
      provider.mockRestore();
    }
  });

  it("retains immutable report overlay history when native reconciliation advances its revision", async () => {
    const scopeId = randomUUID(),
      artifactId = randomUUID();
    const report = { summary: "Canonical report summary." };
    const sourceSha = hash(JSON.stringify(report));
    await first.$transaction((tx) =>
      enqueueAuthoredDocument(tx, {
        scopeId,
        entityId: artifactId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
        canonicalRevision: sourceSha,
        document: report,
      }),
    );
    const job = await first.authoredLocalizationRequest.findFirstOrThrow({
      where: { scopeId, locale: AuthoredLocalizationLocale.EN },
    });
    const legacy = "Reviewed historical paraphrase.";
    await first.authoredLocalizationRequest.update({
      where: { id: job.id },
      data: { state: AUTHORED_LOCALIZATION_STATES.READY },
    });
    await first.authoredLocalizedRevision.create({
      data: {
        requestId: job.id,
        content: legacy,
        contentSha256: hash(legacy),
        engine: "legacy-provider",
        engineVersion: "1",
      },
    });
    await service.reviewOutput(
      scopeId,
      job.id,
      {
        originSha256: job.originSha256,
        contentSha256: hash(legacy),
        confirmsTargetLanguageAndMeaning: true,
        evidence: "Isolated legacy output review",
      },
      "output-reviewer",
    );
    const previous = await service.localizedReport(
      scopeId,
      artifactId,
      sourceSha,
      report,
      "en",
    );
    const previousBytes = Buffer.from(previous.content);
    await service.reviewSource(
      scopeId,
      job.id,
      {
        sourceLanguage: AuthoredSourceLanguage.EN,
        originSha256: job.originSha256,
        canonicalRevision: sourceSha,
        evidence: "Isolated canonical report source-language review",
      },
      "source-reviewer",
    );
    await expect(
      replica.localizedReport(scopeId, artifactId, sourceSha, report, "en"),
    ).rejects.toThrow();
    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("Non-native provider unavailable in fixture"),
      );
    try {
      await service.drain();
    } finally {
      provider.mockRestore();
    }
    const current = await replica.localizedReport(
      scopeId,
      artifactId,
      sourceSha,
      report,
      "en",
    );
    expect(current.translationRevision).toBe(2);
    expect(current.id).not.toBe(previous.id);
    expect(
      Buffer.from(
        (
          await first.localizedReportArtifact.findUniqueOrThrow({
            where: { id: previous.id },
          })
        ).content,
      ),
    ).toEqual(previousBytes);
    expect(
      await replica.localizedReportDocument(
        scopeId,
        artifactId,
        sourceSha,
        report,
        "en",
      ),
    ).toEqual(report);
  });

  it("resolves UNKNOWN through review, preserves origin immutability and retains retries on provider failure or unsupported content", async () => {
    const fixture = await enqueue({
      summary: "Reviewed original English content.",
    });
    const job = fixture.rows[0];
    const binding = {
      originSha256: job.originSha256,
      canonicalRevision: "1",
      evidence: "Authorized source-language determination fixture",
    };
    await service.reviewSource(
      fixture.scopeId,
      job.id,
      { ...binding, sourceLanguage: AuthoredSourceLanguage.UNKNOWN },
      "reviewer",
    );
    await expect(
      service.reviewSource(
        fixture.scopeId,
        job.id,
        {
          ...binding,
          originSha256: "0".repeat(64),
          sourceLanguage: AuthoredSourceLanguage.EN,
        },
        "reviewer",
      ),
    ).rejects.toThrow();
    await service.reviewSource(
      fixture.scopeId,
      job.id,
      { ...binding, sourceLanguage: AuthoredSourceLanguage.EN },
      "reviewer",
    );
    await expect(
      first.authoredLocalizationRequest.update({
        where: { id: job.id },
        data: { originalContent: "Changed original" },
      }),
    ).rejects.toThrow();
    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Isolated provider failure"));
    try {
      await service.drain();
      const failed = await first.authoredLocalizationRequest.findFirstOrThrow({
        where: {
          scopeId: fixture.scopeId,
          locale: AuthoredLocalizationLocale.VI,
        },
      });
      expect(failed.state).toBe(AUTHORED_LOCALIZATION_STATES.PENDING);
      expect(failed.attempts).toBe(1);
      expect(failed.leaseToken).toBeNull();
      provider.mockResolvedValue(Response.json({ content: 42 }));
      await first.authoredLocalizationRequest.update({
        where: { id: failed.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await replica.drain();
      const retried = await first.authoredLocalizationRequest.findUniqueOrThrow(
        { where: { id: failed.id } },
      );
      expect(retried.state).toBe(AUTHORED_LOCALIZATION_STATES.PENDING);
      expect(retried.attempts).toBe(2);
      expect(
        await first.authoredLocalizedRevision.count({
          where: { requestId: failed.id },
        }),
      ).toBe(0);
      expect(
        (
          await first.authoredLocalizationRequest.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).originalContent,
      ).toBe(job.originalContent);
    } finally {
      provider.mockRestore();
    }
  });

  it("handles different field languages, rejects wrong provider locale, and retries without publishing unchecked output", async () => {
    const fixture = await enqueue({
      title: "Verified English title.",
      summary: "Nội dung tiếng Việt đã được xác nhận.",
    });
    for (const path of ["/title", "/summary"]) {
      const job = fixture.rows.find((row) => row.fieldPath === path)!;
      await service.reviewSource(
        fixture.scopeId,
        job.id,
        {
          sourceLanguage:
            path === "/title"
              ? AuthoredSourceLanguage.EN
              : AuthoredSourceLanguage.VI,
          originSha256: job.originSha256,
          canonicalRevision: "1",
          evidence: "Per-field independent source review fixture",
        },
        "source-reviewer",
      );
    }
    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        if (typeof init?.body !== "string")
          throw new Error("Serialized request required");
        const body = JSON.parse(init.body) as {
          locale: string;
          originSha256: string;
        };
        return Promise.resolve(
          Response.json({
            locale: body.locale === "en" ? "vi" : "en",
            originSha256: body.originSha256,
            content: "Wrong target candidate",
            engine: "fixture",
            engineVersion: "1",
          }),
        );
      });
    try {
      await service.drain();
      expect(provider).toHaveBeenCalledTimes(2);
      expect(
        await first.authoredTranslationCandidate.count({
          where: { request: { scopeId: fixture.scopeId } },
        }),
      ).toBe(0);
      const jobs = await first.authoredLocalizationRequest.findMany({
        where: { scopeId: fixture.scopeId },
      });
      expect(
        jobs.filter((row) => row.state === AUTHORED_LOCALIZATION_STATES.READY),
      ).toHaveLength(2);
      expect(
        jobs.filter(
          (row) => row.state === AUTHORED_LOCALIZATION_STATES.PENDING,
        ),
      ).toHaveLength(2);
      provider.mockImplementation((_input, init) => {
        if (typeof init?.body !== "string")
          throw new Error("Serialized request required");
        const body = JSON.parse(init.body) as {
          locale: string;
          originSha256: string;
        };
        return Promise.resolve(
          Response.json({
            locale: body.locale,
            originSha256: body.originSha256,
            content: "Candidate awaiting review",
            engine: "fixture",
            engineVersion: "2",
          }),
        );
      });
      await first.authoredLocalizationRequest.updateMany({
        where: {
          scopeId: fixture.scopeId,
          state: AUTHORED_LOCALIZATION_STATES.PENDING,
        },
        data: { nextAttemptAt: new Date(0) },
      });
      await Promise.all([service.drain(), replica.drain()]);
      expect(
        await first.authoredTranslationCandidate.count({
          where: { request: { scopeId: fixture.scopeId } },
        }),
      ).toBe(2);
      expect(
        await first.authoredLocalizedRevision.count({
          where: { request: { scopeId: fixture.scopeId } },
        }),
      ).toBe(2);
    } finally {
      provider.mockRestore();
    }
  });

  it.each([AuthoredSourceLanguage.EN, AuthoredSourceLanguage.VI])(
    "copies verified %s bytes exactly and queues the other locale for independent output review",
    async (sourceLanguage) => {
      const original =
        sourceLanguage === AuthoredSourceLanguage.VI
          ? "Nội dung được người rà soát xác nhận."
          : "The reviewer verified this source text.";
      const fixture = await enqueue({ summary: original });
      const job = fixture.rows[0];
      await service.reviewSource(
        fixture.scopeId,
        job.id,
        {
          sourceLanguage,
          originSha256: job.originSha256,
          canonicalRevision: "1",
          evidence: "Independent source language review fixture v1",
        },
        "authorized-source-reviewer",
      );
      const provider = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation((_input, init) => {
          if (typeof init?.body !== "string")
            throw new Error("Expected serialized provider request");
          const body = JSON.parse(init.body) as {
            locale: string;
            originSha256: string;
          };
          return Promise.resolve(
            Response.json({
              locale: body.locale,
              originSha256: body.originSha256,
              content:
                "Explicit provider candidate, pending human target review.",
              engine: "isolated-provider",
              engineVersion: "1",
            }),
          );
        });
      try {
        await Promise.all([service.drain(), replica.drain()]);
        const rows = await first.authoredLocalizationRequest.findMany({
          where: { scopeId: fixture.scopeId },
          include: { revision: true, candidate: true },
        });
        const native = rows.find((row) => row.locale === sourceLanguage)!;
        const translated = rows.find((row) => row.locale !== sourceLanguage)!;
        expect(native.revision?.content).toBe(original);
        expect(native.revision?.contentSha256).toBe(hash(original));
        expect(native.revision?.engine).toBe("CANONICAL_ORIGINAL");
        expect(native.state).toBe(AUTHORED_LOCALIZATION_STATES.READY);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(translated.state).toBe(AUTHORED_LOCALIZATION_STATES.PENDING);
        expect(translated.errorCode).toBe(
          AUTHORED_LANGUAGE_REVIEW_CODES.OUTPUT_REQUIRED,
        );
        await service.reviewOutput(
          fixture.scopeId,
          translated.id,
          {
            originSha256: translated.originSha256,
            contentSha256: translated.candidate!.contentSha256,
            confirmsTargetLanguageAndMeaning: true,
            evidence: "Independent output review fixture v1",
          },
          "authorized-output-reviewer",
        );
        await replica.drain();
        expect(provider).toHaveBeenCalledTimes(1);
        const persisted = await replica.project(
          [original],
          sourceLanguage === AuthoredSourceLanguage.EN ? "en" : "vi",
          fixture.scopeId,
          {
            entityId: fixture.scopeId,
            entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
            canonicalRevision: "1",
          },
        );
        expect(persisted.get(original)).toBe(original);
        expect(
          (
            await first.authoredLocalizationRequest.findUniqueOrThrow({
              where: { id: native.id },
            })
          ).originalContent,
        ).toBe(original);
        expect(
          await first.authoredLocalizedRevision.count({
            where: { requestId: { in: rows.map((row) => row.id) } },
          }),
        ).toBe(2);
      } finally {
        provider.mockRestore();
      }
    },
  );

  it.each([AuthoredSourceLanguage.MIXED, AuthoredSourceLanguage.UNKNOWN])(
    "keeps %s pending without provider calls and supports audited derived normalization",
    async (sourceLanguage) => {
      const fixture = await enqueue({ summary: "Original mixed nội dung" });
      const job = fixture.rows[0];
      if (sourceLanguage === AuthoredSourceLanguage.MIXED)
        await service.reviewSource(
          fixture.scopeId,
          job.id,
          {
            sourceLanguage,
            canonicalRevision: "1",
            originSha256: job.originSha256,
            evidence: "Reviewed mixed-language original field",
          },
          "authorized-source-reviewer",
        );
      const provider = jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Unknown origin must not reach provider"));
      try {
        await service.drain();
        expect(provider).not.toHaveBeenCalled();
        await expect(
          replica.project(
            [job.originalContent],
            job.locale === AuthoredLocalizationLocale.EN ? "en" : "vi",
            fixture.scopeId,
          ),
        ).rejects.toThrow();
        const normalizedContent =
          job.locale === AuthoredLocalizationLocale.EN
            ? "Reviewed derived English representation."
            : "Bản diễn đạt tiếng Việt đã được rà soát.";
        await service.reviewOutput(
          fixture.scopeId,
          job.id,
          {
            originSha256: job.originSha256,
            contentSha256: hash(normalizedContent),
            normalizedContent,
            confirmsTargetLanguageAndMeaning: true,
            evidence: "Authorized normalization and target-language review v1",
          },
          "authorized-normalization-reviewer",
        );
        expect(
          (
            await first.authoredLocalizationRequest.findUniqueOrThrow({
              where: { id: job.id },
            })
          ).originalContent,
        ).toBe(job.originalContent);
        expect(
          await first.authoredLocalizationReview.count({
            where: { requestId: job.id },
          }),
        ).toBeGreaterThan(0);
      } finally {
        provider.mockRestore();
      }
    },
  );

  it("projects /findings/0/summary and /findings/1/summary with identical canonical text to distinct path-bound reviewed translations without conflict or cross-field substitution", async () => {
    const scopeId = randomUUID();
    const entityId = randomUUID();
    const sharedSummary = "Access tokens must expire within 15 minutes.";
    const document = {
      summary: "Overall report summary.",
      findings: [
        {
          assessmentRuleId: "RULE-AUTH-01",
          summary: sharedSummary,
          recommendations: ["Configure short-lived access tokens."],
        },
        {
          assessmentRuleId: "RULE-SESSION-02",
          summary: sharedSummary,
          recommendations: ["Enforce idle session timeout."],
        },
      ],
    };
    const canonicalRevision = hash(JSON.stringify(document));
    await first.$transaction((tx) =>
      enqueueAuthoredDocument(tx, {
        scopeId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
        entityId,
        canonicalRevision,
        document,
        sourceLanguages: {},
      }),
    );
    const rows = await first.authoredLocalizationRequest.findMany({
      where: { scopeId, entityId },
    });
    for (const row of rows) {
      if (row.locale === AuthoredLocalizationLocale.EN) {
        await service.reviewSource(
          scopeId,
          row.id,
          {
            sourceLanguage: AuthoredSourceLanguage.EN,
            canonicalRevision,
            originSha256: row.originSha256,
            evidence: `Verified English source at ${row.fieldPath}`,
          },
          "source-reviewer",
        );
      }
    }
    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as {
          locale: string;
          originSha256: string;
        };
        return Promise.resolve(
          Response.json({
            locale: body.locale,
            originSha256: body.originSha256,
            content: "Bản dịch ứng viên chờ người rà soát xác nhận.",
            engine: "isolated-provider",
            engineVersion: "1",
          }),
        );
      });
    try {
      await service.drain();
      await service.drain();
    } finally {
      provider.mockRestore();
    }
    const viRows = await first.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        entityId,
        locale: AuthoredLocalizationLocale.VI,
      },
      include: { candidate: true },
    });
    const f0Translation =
      "Mã thông báo truy cập API phải hết hạn trong vòng 15 phút (Ngữ cảnh 0).";
    const f1Translation =
      "Phiên đăng nhập người dùng phải hết hạn sau 15 phút (Ngữ cảnh 1).";
    for (const row of viRows) {
      const normalizedContent =
        row.fieldPath === "/findings/0/summary"
          ? f0Translation
          : row.fieldPath === "/findings/1/summary"
            ? f1Translation
            : row.candidate!.content;
      await service.reviewOutput(
        scopeId,
        row.id,
        {
          originSha256: row.originSha256,
          contentSha256: hash(normalizedContent),
          ...(normalizedContent !== row.candidate!.content
            ? { normalizedContent }
            : {}),
          confirmsTargetLanguageAndMeaning: true,
          evidence: `Context-specific VI review for ${row.fieldPath}`,
        },
        "vi-output-reviewer",
      );
    }

    const localizedDoc = await replica.projectDocument(
      document,
      "vi",
      scopeId,
      {
        entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
        entityId,
        canonicalRevision,
      },
    );
    expect(localizedDoc.findings[0].summary).toBe(f0Translation);
    expect(localizedDoc.findings[1].summary).toBe(f1Translation);

    const localizedReport = (await replica.localizedReportDocument(
      scopeId,
      entityId,
      canonicalRevision,
      document,
      "vi",
    )) as typeof document;
    expect(localizedReport.findings[0].summary).toBe(f0Translation);
    expect(localizedReport.findings[1].summary).toBe(f1Translation);
  });

  it("discovers backlog without a known scopeId, supports verified write evidence, bounded batch review, candidate rejection and controlled retry", async () => {
    const scopeId = randomUUID();
    const entityId = randomUUID();
    const document = {
      title: "Verified English legal requirement title.",
      summary: "Unreviewed second field requiring batch attestation.",
    };
    const canonicalRevision = hash(JSON.stringify(document));

    await expect(
      first.$transaction((tx) =>
        enqueueAuthoredDocument(tx, {
          scopeId,
          entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
          entityId,
          canonicalRevision,
          document,
          sourceLanguages: { "/title": AuthoredSourceLanguage.EN },
          verifiedSourceEvidence: {
            "/title": {
              sourceLanguage: AuthoredSourceLanguage.EN,
              originSha256: hash("tampered-sha"),
              actorId: "write-boundary-reviewer",
              evidence: "Mismatched hash must fail closed at write boundary",
            },
          },
        }),
      ),
    ).rejects.toThrow();

    await first.$transaction((tx) =>
      enqueueAuthoredDocument(tx, {
        scopeId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
        entityId,
        canonicalRevision,
        document,
        sourceLanguages: { "/title": AuthoredSourceLanguage.EN },
        verifiedSourceEvidence: {
          "/title": {
            sourceLanguage: AuthoredSourceLanguage.EN,
            originSha256: hash(document.title),
            actorId: "write-boundary-reviewer",
            evidence:
              "Verified English source provenance bound at write boundary",
          },
        },
      }),
    );

    let cursor: string | undefined;
    let initialBacklog = await service.backlog(
      undefined,
      AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
    );
    let scopeSummary = initialBacklog.scopes.find(
      (item) => item.scopeId === scopeId,
    );
    while (!scopeSummary && initialBacklog.nextAfterScopeId) {
      cursor = initialBacklog.nextAfterScopeId;
      initialBacklog = await service.backlog(
        cursor,
        AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
      );
      scopeSummary = initialBacklog.scopes.find(
        (item) => item.scopeId === scopeId,
      );
    }
    expect(scopeSummary).toBeDefined();
    expect(scopeSummary?.counts.UNKNOWN_SOURCE).toBe(2);
    expect(scopeSummary?.counts.SOURCE_REVIEW_REQUIRED).toBe(2);
    expect(scopeSummary?.counts.PROVIDER_PENDING).toBe(2);
    expect(scopeSummary?.readiness.en).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.REVIEW_REQUIRED,
    );
    expect(initialBacklog.operations.providerConfigured).toBe(true);
    expect(initialBacklog.operations.batchLimit).toBe(50);

    const { items: queue } = await service.reviewQueue(scopeId);
    const summaryEn = queue.find(
      (row) => row.fieldPath === "/summary" && row.locale === "en",
    )!;
    const titleEn = queue.find(
      (row) => row.fieldPath === "/title" && row.locale === "en",
    )!;

    const batchSourceResult = await service.batchReviewSource(
      scopeId,
      {
        confirmsIndividualFieldReview: true,
        evidence: "Batch reviewed /summary as English and tested stale item",
        items: [
          {
            requestId: summaryEn.id,
            originSha256: summaryEn.originSha256,
            canonicalRevision: summaryEn.canonicalRevision,
            sourceLanguage: AuthoredSourceLanguage.EN,
          },
          {
            requestId: titleEn.id,
            originSha256: hash("stale-origin"),
            canonicalRevision: titleEn.canonicalRevision,
            sourceLanguage: AuthoredSourceLanguage.EN,
          },
        ],
      },
      "batch-source-reviewer",
    );
    expect(batchSourceResult.acceptedCount).toBe(1);
    expect(batchSourceResult.rejectedCount).toBe(1);

    const provider = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as {
          locale: string;
          originSha256: string;
          content: string;
        };
        return Promise.resolve(
          Response.json({
            locale: body.locale,
            originSha256: body.originSha256,
            content: `Ứng viên dịch tiếng Việt: ${body.content}`,
            engine: "isolated-provider",
            engineVersion: "1",
          }),
        );
      });
    try {
      await service.drain();
      await service.drain();
    } finally {
      provider.mockRestore();
    }

    const { items: afterDrain } = await service.reviewQueue(scopeId);
    const titleVi = afterDrain.find(
      (row) => row.fieldPath === "/title" && row.locale === "vi",
    )!;
    const summaryVi = afterDrain.find(
      (row) => row.fieldPath === "/summary" && row.locale === "vi",
    )!;
    expect(titleVi.candidate).not.toBeNull();
    expect(summaryVi.candidate).not.toBeNull();

    const rejected = await service.retryOrRejectCandidate(
      scopeId,
      titleVi.id,
      {
        action: AUTHORED_CANDIDATE_ACTIONS.REJECT,
        originSha256: titleVi.originSha256,
        canonicalRevision: titleVi.canonicalRevision,
        candidateSha256: titleVi.candidate!.contentSha256,
        evidence: "Rejected candidate due to inaccurate legal terminology",
      },
      "candidate-reviewer",
    );
    expect(rejected.state).toBe(AUTHORED_LOCALIZATION_STATES.FAILED);
    expect(await replica.scopeReadiness(scopeId, "vi")).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.FAILED,
    );

    await expect(
      service.reviewOutput(
        scopeId,
        titleVi.id,
        {
          originSha256: titleVi.originSha256,
          contentSha256: titleVi.candidate!.contentSha256,
          confirmsTargetLanguageAndMeaning: true,
          evidence:
            "Attempted to approve rejected candidate without normalization",
        },
        "candidate-reviewer",
      ),
    ).rejects.toThrow();

    const retried = await service.retryOrRejectCandidate(
      scopeId,
      titleVi.id,
      {
        action: AUTHORED_CANDIDATE_ACTIONS.RETRY,
        originSha256: titleVi.originSha256,
        canonicalRevision: titleVi.canonicalRevision,
        evidence: "Requested controlled retry after rejecting candidate",
      },
      "candidate-reviewer",
    );
    expect(retried.state).toBe(AUTHORED_LOCALIZATION_STATES.PENDING);
    expect(retried.translationRevision).toBe(2);

    const retryProvider = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as {
          locale: string;
          originSha256: string;
        };
        return Promise.resolve(
          Response.json({
            locale: body.locale,
            originSha256: body.originSha256,
            content: "Tiêu đề yêu cầu pháp lý đã được dịch lại chính xác.",
            engine: "isolated-provider",
            engineVersion: "2",
          }),
        );
      });
    try {
      await service.drain();
    } finally {
      retryProvider.mockRestore();
    }

    const retriedRow =
      await first.authoredLocalizationRequest.findUniqueOrThrow({
        where: { id: retried.id },
        include: { candidate: true },
      });
    expect(retriedRow.candidate?.content).toBe(
      "Tiêu đề yêu cầu pháp lý đã được dịch lại chính xác.",
    );

    const batchOutputResult = await service.batchReviewOutput(
      scopeId,
      {
        confirmsTargetLanguageAndMeaning: true,
        evidence: "Batch approved verified Vietnamese translations",
        items: [
          {
            requestId: retriedRow.id,
            originSha256: retriedRow.originSha256,
            contentSha256: retriedRow.candidate!.contentSha256,
          },
          {
            requestId: summaryVi.id,
            originSha256: summaryVi.originSha256,
            contentSha256: hash("Trường thứ hai đã được chuẩn hóa tiếng Việt."),
            normalizedContent: "Trường thứ hai đã được chuẩn hóa tiếng Việt.",
          },
        ],
      },
      "batch-output-reviewer",
    );
    expect(batchOutputResult.acceptedCount).toBe(2);
    expect(batchOutputResult.rejectedCount).toBe(0);

    expect(await replica.scopeReadiness(scopeId, "en")).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.READY,
    );
    expect(await replica.scopeReadiness(scopeId, "vi")).toBe(
      AUTHORED_LOCALIZATION_READINESS_STATES.READY,
    );

    const localizedVi = await replica.projectDocument(document, "vi", scopeId, {
      entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
      entityId,
      canonicalRevision,
    });
    expect(localizedVi.title).toBe(
      "Tiêu đề yêu cầu pháp lý đã được dịch lại chính xác.",
    );
    expect(localizedVi.summary).toBe(
      "Trường thứ hai đã được chuẩn hóa tiếng Việt.",
    );
  });
});

import type { CorpusPreparationTerminalStatus } from "@lcsp/contracts/legal-rule-catalog";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Optional,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import type {
  ApproveLegalCorpusRequest,
  IngestLegalCorpusRequest,
  RegisterValidatedRetrievalIndexRequest,
} from "../../application/contracts/legal-corpus.contract.js";
import type { RegisterOfficialSourceSnapshotRequest } from "../../application/contracts/official-source-snapshot.contract.js";

import { GetActiveLegalCorpusQuery } from "../../application/queries/get-active-legal-corpus/get-active-legal-corpus.query.js";

import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { LegalCorpusService } from "../../application/services/legal-corpus.service.js";
import { OfficialSourceSnapshotService } from "../../application/services/official-source-snapshot.service.js";
import { AdminCorpusVersionsService } from "../../application/services/admin-corpus-versions.service.js";

@Controller("internal/legal-rule-catalog")
export class LegalRuleCatalogController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly legalCorpus: LegalCorpusService,
    private readonly officialSourceSnapshots: OfficialSourceSnapshotService,
    @Optional()
    private readonly adminCorpusVersions?: AdminCorpusVersionsService,
  ) {}

  @Post("corpus/validated-draft")
  @HttpCode(201)
  @UseGuards(WorkerApiKeyGuard)
  async ingestValidatedCorpusDraft(@Body() body: IngestLegalCorpusRequest) {
    return resultEnvelope(
      await this.legalCorpus.ingestDraft({
        ...body,
        ingestionRunId: body.ingestionRunId || randomUUID(),
      }),
    );
  }

  @Post("corpus/:versionId/retrieval-indexes/validated")
  @HttpCode(201)
  @UseGuards(WorkerApiKeyGuard)
  async registerValidatedRetrievalIndex(
    @Param("versionId") versionId: string,
    @Body() body: RegisterValidatedRetrievalIndexRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.legalCorpus.registerValidatedRetrievalIndex({
        corpusVersionId: versionId,
        version: body.version,
        configHash: body.configHash,
        contentHash: body.contentHash,
        validationManifestRef: body.validationManifestRef,
        validatedAt: body.validatedAt ?? null,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("corpus/:versionId/activate-validated")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async activateValidatedCorpusVersion(
    @Param("versionId") versionId: string,
    @Body() body: ApproveLegalCorpusRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.legalCorpus.activateValidatedCorpusVersion({
        corpusVersionId: versionId,
        integrityManifestRef: body.integrityManifestRef,
        retrievalValidationRef: body.retrievalValidationRef,
        idempotencyKey: body.idempotencyKey,
        scopeDescription:
          body.scopeDescription?.trim() || "Activated via worker API",
        comments: body.comments ?? null,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("corpus/:versionId/preparation-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async preparationCallback(
    @Param("versionId") versionId: string,
    @Body()
    body: {
      preparationId: string;
      status: CorpusPreparationTerminalStatus;
      readiness?: Record<string, string>;
      integrityManifestRef?: string | null;
      retrievalValidationRef?: string | null;
      errorCode?: string | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!this.adminCorpusVersions)
      throw new Error("Admin corpus preparation service unavailable");
    return resultEnvelope(
      await this.adminCorpusVersions.completePreparation({
        preparationId: body.preparationId,
        corpusVersionId: versionId,
        status: body.status,
        readiness: body.readiness,
        integrityManifestRef: body.integrityManifestRef,
        retrievalValidationRef: body.retrievalValidationRef,
        errorCode: body.errorCode,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Get("corpus/active")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getActiveCorpus() {
    return resultEnvelope(
      await this.queryBus.execute(new GetActiveLegalCorpusQuery()),
    );
  }

  @Get("corpus/:versionId/chunks")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getCorpusChunks(@Param("versionId") versionId: string) {
    const corpus = await this.legalCorpus.getApprovedChunks(versionId);
    return resultEnvelope(corpus);
  }

  @Post("source-snapshots")
  @HttpCode(201)
  @UseGuards(WorkerApiKeyGuard)
  async registerOfficialSourceSnapshot(
    @Body() body: RegisterOfficialSourceSnapshotRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.officialSourceSnapshots.register(
        body,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Get("source-snapshots")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getOfficialSourceSnapshot(
    @Query("snapshot_ref") snapshotRef: string | undefined,
    @Query("snapshot_id") snapshotId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.officialSourceSnapshots.get(
        { snapshotRef, snapshotId },
        req.correlationId || randomUUID(),
      ),
    );
  }
}

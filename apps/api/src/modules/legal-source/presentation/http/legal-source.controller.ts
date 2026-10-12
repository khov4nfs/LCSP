import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import type {
  ActivateLegalSourceRequest,
  IngestLegalSourceRequest,
  RegisterValidatedRetrievalIndexRequest,
} from "../../application/contracts/legal-source.contract.js";
import type { RegisterOfficialSourceSnapshotRequest } from "../../application/contracts/official-source-snapshot.contract.js";

import { GetActiveLegalSourceQuery } from "../../application/queries/get-active-legal-source/get-active-legal-source.query.js";

import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { LegalSourceService } from "../../application/services/legal-source.service.js";
import { OfficialSourceSnapshotService } from "../../application/services/official-source-snapshot.service.js";

@Controller("internal/legal-sources")
export class LegalSourceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly legalSource: LegalSourceService,
    private readonly officialSourceSnapshots: OfficialSourceSnapshotService,
  ) {}

  @Post("validated-draft")
  @HttpCode(201)
  @UseGuards(WorkerApiKeyGuard)
  async ingestValidatedLegalSourceDraft(
    @Body() body: IngestLegalSourceRequest,
  ) {
    return resultEnvelope(
      await this.legalSource.ingestDraft({
        ...body,
        ingestionRunId: body.ingestionRunId || randomUUID(),
      }),
    );
  }

  @Post(":versionId/retrieval-indexes/validated")
  @HttpCode(201)
  @UseGuards(WorkerApiKeyGuard)
  async registerValidatedRetrievalIndex(
    @Param("versionId") versionId: string,
    @Body() body: RegisterValidatedRetrievalIndexRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.legalSource.registerValidatedRetrievalIndex({
        legalSourceVersionId: versionId,
        version: body.version,
        configHash: body.configHash,
        contentHash: body.contentHash,
        validationManifestRef: body.validationManifestRef,
        validatedAt: body.validatedAt ?? null,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post(":versionId/activate-validated")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async activateValidatedLegalSourceVersion(
    @Param("versionId") versionId: string,
    @Body() body: ActivateLegalSourceRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.legalSource.activateValidatedLegalSourceVersion({
        legalSourceVersionId: versionId,
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

  @Get("active")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getActiveLegalSource() {
    return resultEnvelope(
      await this.queryBus.execute(new GetActiveLegalSourceQuery()),
    );
  }

  @Get(":versionId/chunks")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getLegalSourceChunks(@Param("versionId") versionId: string) {
    const legalSource = await this.legalSource.getActiveChunks(versionId);
    return resultEnvelope(legalSource);
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

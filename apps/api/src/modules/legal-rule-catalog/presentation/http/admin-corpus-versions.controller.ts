import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AdminCorpusVersionsService } from "../../application/services/admin-corpus-versions.service.js";

@Controller("admin/corpus-versions")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class AdminCorpusVersionsController {
  constructor(private readonly corpusVersions: AdminCorpusVersionsService) {}

  @Get()
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return resultEnvelope(
      await this.corpusVersions.list({
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }

  @Post("prepare")
  @HttpCode(202)
  async prepare(
    @Body() body: { idempotencyKey?: string } | undefined,
    @Headers("x-idempotency-key") headerKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.corpusVersions.prepare({
        actorId: request.rbacContext.userId,
        idempotencyKey: (body?.idempotencyKey ?? headerKey)?.trim() ?? "",
        correlationId: request.correlationId || randomUUID(),
      }),
    );
  }

  @Get(":versionId")
  async detail(@Param("versionId") versionId: string) {
    return resultEnvelope(await this.corpusVersions.detail(versionId));
  }

  @Post(":versionId/discard")
  @HttpCode(200)
  async discard(
    @Param("versionId") versionId: string,
    @Body() body: { idempotencyKey?: string } | undefined,
    @Headers("x-idempotency-key") headerKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.corpusVersions.discardDraft({
        versionId,
        actorId: request.rbacContext.userId,
        idempotencyKey: (body?.idempotencyKey ?? headerKey)?.trim() ?? "",
        correlationId: request.correlationId || randomUUID(),
      }),
    );
  }

  @Post(":versionId/publish")
  @HttpCode(200)
  async publish(
    @Param("versionId") versionId: string,
    @Body() body: { idempotencyKey?: string } | undefined,
    @Headers("x-idempotency-key") headerKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.corpusVersions.publish({
        versionId,
        actorId: request.rbacContext.userId,
        idempotencyKey: (body?.idempotencyKey ?? headerKey)?.trim() ?? "",
        correlationId: request.correlationId || randomUUID(),
      }),
    );
  }
}

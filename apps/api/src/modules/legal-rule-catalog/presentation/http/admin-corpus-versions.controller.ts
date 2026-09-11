import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
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
  async list() {
    return resultEnvelope(await this.corpusVersions.list());
  }

  @Get(":versionId")
  async detail(@Param("versionId") versionId: string) {
    return resultEnvelope(await this.corpusVersions.detail(versionId));
  }

  @Post(":versionId/discard")
  @HttpCode(200)
  async discard(
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.corpusVersions.discardDraft({
        versionId,
        actorId: request.rbacContext.userId,
        correlationId: request.correlationId || randomUUID(),
      }),
    );
  }
}

import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  Get,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { DraftLegalRuleRequest } from "../../application/contracts/draft-legal-rule.contract.js";
import type { ApproveRuleCatalogVersionRequest } from "../../application/contracts/approve-catalog-version.contract.js";
import type { CreateRuleCatalogVersionRequest } from "../../application/contracts/create-catalog-version.contract.js";
import type {
  ApproveLegalCorpusRequest,
  IngestLegalCorpusRequest,
} from "../../application/contracts/legal-corpus.contract.js";

import { DraftLegalRuleCommand } from "../../application/commands/draft-legal-rule/draft-legal-rule.command.js";
import { ApproveRuleCatalogVersionCommand } from "../../application/commands/approve-rule-catalog-version/approve-rule-catalog-version.command.js";
import { GetActiveRuleCatalogQuery } from "../../application/queries/get-active-rule-catalog/get-active-rule-catalog.query.js";
import { GetActiveLegalCorpusQuery } from "../../application/queries/get-active-legal-corpus/get-active-legal-corpus.query.js";

import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { LegalCorpusService } from "../../application/services/legal-corpus.service.js";
import { RuleCatalogVersionService } from "../../application/services/rule-catalog-version.service.js";

@Controller("internal/legal-rule-catalog")
export class LegalRuleCatalogController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly legalCorpus: LegalCorpusService,
    private readonly catalogVersions: RuleCatalogVersionService,
  ) {}

  @Post("versions")
  @HttpCode(201)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalRuleCatalogAuthor)
  async createVersion(
    @Body() body: CreateRuleCatalogVersionRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalogVersions.createDraft(
        body.version,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Post("corpus")
  @HttpCode(201)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalCorpusIngest)
  async ingestCorpus(@Body() body: IngestLegalCorpusRequest) {
    return resultEnvelope(
      await this.legalCorpus.ingestDraft({
        ...body,
        ingestionRunId: body.ingestionRunId || randomUUID(),
      }),
    );
  }

  @Post("corpus/:versionId/approve")
  @HttpCode(200)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalCorpusApprove)
  async approveCorpus(
    @Param("versionId") versionId: string,
    @Body() body: ApproveLegalCorpusRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.legalCorpus.approveDraft({
        corpusVersionId: versionId,
        approvedBy: req.pbacContext.userId,
        scopeDescription: body.scopeDescription?.trim() || "Approved via API",
        comments: body.comments ?? null,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("rules")
  @HttpCode(201)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalRuleCatalogAuthor)
  async draftRule(
    @Body() body: DraftLegalRuleRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new DraftLegalRuleCommand(
          body.legalRuleId,
          body.ruleFamily,
          body.requiredFacts,
          body.optionalFacts,
          body.blockingFacts,
          body.unknownFactPolicy,
          body.citationLocatorRefs,
          userId,
          body.legalRuleCatalogVersionId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
          correlationId,
        ),
      ),
    );
  }

  @Get("active")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getActiveCatalog() {
    return resultEnvelope(
      await this.queryBus.execute(new GetActiveRuleCatalogQuery()),
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

  @Post("versions/:versionId/approve")
  @HttpCode(200)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalRuleCatalogApprove)
  async approveVersion(
    @Param("versionId") versionId: string,
    @Body() body: ApproveRuleCatalogVersionRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    // Passing some default values for scopeDescription since they are not in the contract body
    return resultEnvelope(
      await this.commandBus.execute(
        new ApproveRuleCatalogVersionCommand(
          versionId,
          "Approved via API", // default scopeDescription
          null, // no comments provided in the basic API body yet
          userId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
          correlationId,
        ),
      ),
    );
  }
}

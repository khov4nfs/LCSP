import {
  Controller,
  Put,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  Res,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { SaveWizardDraftRequest } from "../../application/contracts/wizard/wizard-draft.contract.js";
import type { SubmitWizardRequest } from "../../application/contracts/wizard/wizard-submit.contract.js";
import { SaveWizardDraftCommand } from "../../application/commands/save-wizard-draft/save-wizard-draft.command.js";
import { SubmitWizardCommand } from "../../application/commands/submit-wizard/submit-wizard.command.js";
import { GenerateReadinessExportCommand } from "../../application/commands/generate-readiness-export/generate-readiness-export.command.js";
import { GetReadinessQuery } from "../../application/queries/get-readiness/get-readiness.query.js";
import { DownloadReadinessExportQuery } from "../../application/queries/download-readiness-export/download-readiness-export.query.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { randomUUID } from "node:crypto";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { Response } from "express";

@Controller("assessments")
export class WizardController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Put(":assessmentId/wizard/draft")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.wizardWrite)
  async saveWizardDraft(
    @Param("assessmentId") assessmentId: string,
    @Body() body: SaveWizardDraftRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, organizationId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new SaveWizardDraftCommand(
          assessmentId,
          organizationId,
          userId,
          body.answers,
          correlationId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }

  @Post(":assessmentId/wizard/submit")
  @HttpCode(200)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.wizardSubmit)
  async submitWizard(
    @Param("assessmentId") assessmentId: string,
    @Body() body: SubmitWizardRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, organizationId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitWizardCommand(
          assessmentId,
          organizationId,
          userId,
          body.answers,
          correlationId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }

  @Get(":assessmentId/readiness")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.assessmentRead)
  async getReadiness(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, organizationId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.queryBus.execute(
        new GetReadinessQuery(
          assessmentId,
          organizationId,
          userId,
          correlationId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }

  @Post(":assessmentId/wizard/readiness-export")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.wizardExport)
  async generateReadinessExport(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, organizationId } = req.pbacContext;
    const pbacContext = req.pbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new GenerateReadinessExportCommand(
          assessmentId,
          organizationId,
          userId,
          correlationId,
          {
            subjectRole: pbacContext.subjectRole,
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }

  @Get(":assessmentId/wizard/readiness-exports/:exportId/download")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.wizardExport)
  async downloadReadinessExport(
    @Param("assessmentId") assessmentId: string,
    @Param("exportId") exportId: string,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const { userId, organizationId } = req.pbacContext;
    const download = await this.queryBus.execute(
      new DownloadReadinessExportQuery(
        assessmentId,
        exportId,
        organizationId,
        userId,
        req.correlationId || randomUUID(),
      ),
    );
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="wizard-readiness-export-v${download.version}.pdf"`,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.end(download.pdf);
  }
}

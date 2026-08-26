import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import {
  WIZARD_CLARIFICATION_ASK_MODES,
  type WizardClarificationAskMode,
  type WizardClarificationQuestionRequest,
} from "@lcsp/contracts/wizard";
import { randomUUID } from "node:crypto";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { GenerateReadinessExportCommand } from "../../application/commands/generate-readiness-export/generate-readiness-export.command.js";
import { SaveWizardDraftCommand } from "../../application/commands/save-wizard-draft/save-wizard-draft.command.js";
import { SubmitWizardCommand } from "../../application/commands/submit-wizard/submit-wizard.command.js";
import type { SaveWizardDraftRequest } from "../../application/contracts/wizard/wizard-draft.contract.js";
import type { SubmitWizardRequest } from "../../application/contracts/wizard/wizard-submit.contract.js";
import { DownloadReadinessExportQuery } from "../../application/queries/download-readiness-export/download-readiness-export.query.js";
import { GetReadinessQuery } from "../../application/queries/get-readiness/get-readiness.query.js";
import { WizardClarificationQuestionService } from "../../application/services/wizard/wizard-clarification-question.service.js";

import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";

@Controller("assessments")
export class WizardController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly clarificationQuestions: WizardClarificationQuestionService,
  ) {}

  @Put(":assessmentId/wizard/draft")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async saveWizardDraft(
    @Param("assessmentId") assessmentId: string,
    @Body() body: SaveWizardDraftRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.rbacContext;
    const rbacContext = req.rbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new SaveWizardDraftCommand(
          assessmentId,
          userId,
          body.answers,
          correlationId,
          {
            subjectRole: rbacContext.role,
          },
        ),
      ),
    );
  }

  @Post(":assessmentId/wizard/submit")
  @HttpCode(200)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async submitWizard(
    @Param("assessmentId") assessmentId: string,
    @Body() body: SubmitWizardRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.rbacContext;
    const rbacContext = req.rbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitWizardCommand(
          assessmentId,
          userId,
          body.answers,
          correlationId,
          {
            subjectRole: rbacContext.role,
          },
        ),
      ),
    );
  }

  @Post(":assessmentId/wizard/clarification-questions")
  @HttpCode(200)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  generateClarificationQuestions(
    @Body() body: Partial<WizardClarificationQuestionRequest> | undefined,
  ) {
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const mode = isWizardClarificationAskMode(body?.mode)
      ? body.mode
      : WIZARD_CLARIFICATION_ASK_MODES.wizardDraft;

    return resultEnvelope(
      this.clarificationQuestions.generate(answers, mode, body?.maxQuestions),
    );
  }

  @Get(":assessmentId/readiness")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getReadiness(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.rbacContext;
    const rbacContext = req.rbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.queryBus.execute(
        new GetReadinessQuery(assessmentId, userId, correlationId, {
          subjectRole: rbacContext.role,
        }),
      ),
    );
  }

  @Post(":assessmentId/wizard/readiness-export")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async generateReadinessExport(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId } = req.rbacContext;
    const rbacContext = req.rbacContext;
    const correlationId = req.correlationId || randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new GenerateReadinessExportCommand(
          assessmentId,
          userId,
          correlationId,
          {
            subjectRole: rbacContext.role,
          },
        ),
      ),
    );
  }

  @Get(":assessmentId/wizard/readiness-exports/:exportId/download")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async downloadReadinessExport(
    @Param("assessmentId") assessmentId: string,
    @Param("exportId") exportId: string,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const { userId } = req.rbacContext;
    const download = await this.queryBus.execute(
      new DownloadReadinessExportQuery(
        assessmentId,
        exportId,
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

function isWizardClarificationAskMode(
  value: unknown,
): value is WizardClarificationAskMode {
  return Object.values(WIZARD_CLARIFICATION_ASK_MODES).includes(
    value as WizardClarificationAskMode,
  );
}

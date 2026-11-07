import type { ExecutionContext, INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../src/common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../src/platform/rbac/rbac.guard.js";
import { AuthoredLocalizationService } from "../../src/platform/localization/authored-localization.service.js";
import { AssessmentArtifactController } from "../../src/modules/assessment/presentation/http/assessment-artifact.controller.js";
import { AssessmentController } from "../../src/modules/assessment/presentation/http/assessment.controller.js";
import { AssessmentRuleAuditController } from "../../src/modules/assessment/presentation/http/assessment-rule-audit.controller.js";
import { AssessmentPdfRenderer } from "../../src/modules/assessment/infrastructure/report/assessment-pdf-renderer.service.js";
import { AssessmentReportLoader } from "../../src/modules/assessment/infrastructure/persistence/assessment-report.loader.js";
import { GetAssessmentReportHandler } from "../../src/modules/assessment/application/queries/get-assessment-report/get-assessment-report.handler.js";
import { GetAssessmentReportQuery } from "../../src/modules/assessment/application/queries/get-assessment-report/get-assessment-report.query.js";
import { ListAssessmentEventsHandler } from "../../src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.handler.js";
import { ListAssessmentEventsQuery } from "../../src/modules/assessment/application/queries/list-assessment-events/list-assessment-events.query.js";
import { AssessmentRuleAuditService } from "../../src/modules/assessment/application/services/assessment-rule-audit.service.js";

/** Real customer HTTP controllers and handlers; only identity and persistence are test doubles. */
export async function localizedHttpFixture(input: {
  ownerId: string;
  localization: AuthoredLocalizationService;
  report?: AssessmentReportLoader;
  events?: ListAssessmentEventsHandler;
  catalog?: AssessmentRuleAuditService;
}) {
  const report = input.report
    ? new GetAssessmentReportHandler(input.report)
    : null;
  const module = await Test.createTestingModule({
    controllers: [
      AssessmentArtifactController,
      AssessmentController,
      AssessmentRuleAuditController,
    ],
    providers: [
      {
        provide: QueryBus,
        useValue: {
          execute(query: unknown) {
            if (query instanceof GetAssessmentReportQuery && report)
              return report.execute(query);
            if (query instanceof ListAssessmentEventsQuery && input.events)
              return input.events.execute(query);
            throw new Error("Unexpected localization test query");
          },
        },
      },
      {
        provide: CommandBus,
        useValue: {
          execute() {
            throw new Error("Read-only HTTP fixture cannot write");
          },
        },
      },
      { provide: AuthoredLocalizationService, useValue: input.localization },
      { provide: AssessmentRuleAuditService, useValue: input.catalog ?? {} },
      { provide: AssessmentPdfRenderer, useValue: {} },
    ],
  })
    .overrideGuard(RbacGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        const request = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        request.rbacContext = {
          userId:
            request.headers.authorization === "Bearer fixture-session"
              ? input.ownerId
              : "foreign-owner",
          sessionId: "fixture-session",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        };
        return true;
      },
    })
    .compile();
  const app: INestApplication<Server> = module.createNestApplication();
  await app.init();
  return {
    get(path: string, locale?: string) {
      const request = supertest(app.getHttpServer())
        .get(path)
        .set("authorization", "Bearer fixture-session");
      return locale ? request.set("x-lcsp-locale", locale) : request;
    },
    close: () => app.close(),
  };
}

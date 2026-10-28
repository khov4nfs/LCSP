import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpStatus,
} from "@nestjs/common";
import {
  LEGAL_GRAPH_ERROR_CODES,
  legalGraphQuerySchema,
  type LegalGraphQuery,
} from "@lcsp/contracts/legal-source";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { LegalDocumentGraphService } from "../../application/services/legal-document-graph.service.js";

/** Internal global-source reads; Preparation tools bind the source version server-side. */
@Controller("internal/legal-source-versions")
@UseGuards(WorkerApiKeyGuard)
export class LegalDocumentGraphController {
  constructor(private readonly graph: LegalDocumentGraphService) {}

  @Get(":versionId/graph")
  async query(
    @Param("versionId", new ParseUUIDPipe()) versionId: string,
    @Query(
      new ZodValidationPipe(
        legalGraphQuerySchema,
        LEGAL_GRAPH_ERROR_CODES.invalid,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    query: LegalGraphQuery,
  ) {
    return resultEnvelope(await this.graph.query(versionId, query));
  }
}

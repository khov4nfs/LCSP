import { Query } from "@nestjs/cqrs";

import type { DocumentGenerationContextDto } from "../../contracts/document/document-generation-context.contract.js";

/**
 * Requests the immutable, worker-safe artifact context for one document request.
 *
 * The query is internal-only. It does not generate reports or evaluate gaps; it
 * only resolves authoritative persisted artifacts so Python remains the owner of
 * dossier/report processing.
 */
export class GetDocumentGenerationContextQuery extends Query<DocumentGenerationContextDto> {
  constructor(public readonly documentRequestId: string) {
    super();
  }
}

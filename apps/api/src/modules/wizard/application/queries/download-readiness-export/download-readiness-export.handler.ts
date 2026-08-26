import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  READINESS_EXPORT_ERROR_CODES,
  READINESS_EXPORT_STATUSES,
} from "@lcsp/contracts/wizard";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { ReadinessExportContent } from "../../contracts/wizard/readiness-export.contract.js";
import { ReadinessExportDocumentService } from "../../services/wizard/readiness-export-document.service.js";
import { renderReadinessExportDocx } from "../../services/wizard/readiness-export-docx-template.js";
import { ReadinessExportPdfService } from "../../services/wizard/readiness-export-pdf.service.js";
import { DownloadReadinessExportQuery } from "./download-readiness-export.query.js";
import type { ReadinessExportDownload } from "./download-readiness-export.query.js";

@QueryHandler(DownloadReadinessExportQuery)
export class DownloadReadinessExportHandler implements IQueryHandler<
  DownloadReadinessExportQuery,
  ReadinessExportDownload
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ReadinessExportDocumentService,
    private readonly pdf: ReadinessExportPdfService,
  ) {}

  async execute(
    query: DownloadReadinessExportQuery,
  ): Promise<ReadinessExportDownload> {
    const record = await this.prisma.readinessExport.findFirst({
      where: {
        id: query.exportId,
        assessmentId: query.assessmentId,
        ownerId: query.ownerId,
        status: READINESS_EXPORT_STATUSES.generated,
      },
      select: { contentJson: true, version: true },
    });
    if (!record?.contentJson) {
      throw problemException(
        READINESS_EXPORT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const content = record.contentJson as unknown as ReadinessExportContent;
    const rendered =
      query.format === "docx"
        ? {
            buffer: renderReadinessExportDocx(content, query.locale),
            mediaType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
            extension: "docx" as const,
          }
        : query.locale === "en"
          ? {
              buffer: this.pdf.render(content),
              mediaType: "application/pdf" as const,
              extension: "pdf" as const,
            }
          : this.documents.render(content, "pdf", query.locale);

    return {
      pdf: rendered.buffer,
      document: rendered.buffer,
      mediaType: rendered.mediaType,
      extension: rendered.extension,
      locale: query.locale,
      version: record.version,
    };
  }
}

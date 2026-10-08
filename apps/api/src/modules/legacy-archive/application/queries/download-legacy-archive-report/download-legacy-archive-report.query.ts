import { Query } from "@nestjs/cqrs";

export type LegacyArchiveReportFile = {
  recordId: string;
  filename: string;
  mediaType: string;
  content: Buffer;
  sha256: string;
};

export class DownloadLegacyArchiveReportQuery extends Query<LegacyArchiveReportFile> {
  constructor(
    public readonly ownerId: string,
    public readonly assessmentId: string,
    public readonly recordId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

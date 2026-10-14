import { DownloadIcon, FileTextIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copy } from "../../utils/conversation-copy";

/** View the report in the app, or download the stored artifact. Shown only when a report exists. */
export function AssessmentReportActions({
  assessmentId,
  artifactId,
  pdfSupported = false,
  className,
}: {
  assessmentId: string;
  artifactId: string;
  pdfSupported?: boolean;
  className?: string;
}) {
  const id = encodeURIComponent(assessmentId);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Link
        href={`/assessments/${id}/report`}
        className={buttonVariants({ size: "sm" })}
        data-report-action="view"
      >
        <FileTextIcon aria-hidden="true" />
        {copy("completion.viewReport")}
      </Link>
      <Link
        href={`/assessments/${id}/provenance`}
        className={buttonVariants({ size: "sm", variant: "outline" })}
        data-report-action="provenance"
      >
        <ShieldCheckIcon aria-hidden="true" />
        {copy("completion.viewProvenance")}
      </Link>
      {pdfSupported ? (
        <a
          href={`/api/assessments/${id}/artifacts/${encodeURIComponent(artifactId)}/download`}
          data-artifact-id={artifactId}
          data-report-action="download"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <DownloadIcon aria-hidden="true" />
          {copy("completion.downloadReport")}
        </a>
      ) : null}
      <a
        href={`/api/assessments/${id}/artifacts/${encodeURIComponent(artifactId)}/report.pdf`}
        data-artifact-id={artifactId}
        data-report-action="download-pdf"
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        <FileTextIcon aria-hidden="true" />
        {copy("completion.downloadPdf")}
      </a>
    </div>
  );
}

import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssessmentSummary } from "../../types/workspace.types";
import { AssessmentSummaryCard } from "../molecules/assessment-summary-card";

type AssessmentListProps = {
  assessments: AssessmentSummary[];
  isLoading: boolean;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  loadingLabel: string;
  statusLabel: string;
  createdAtLabel: string;
  getAssessmentHref?: (assessment: AssessmentSummary) => string;
  openAssessmentLabel?: string;
};

export function AssessmentList({
  assessments,
  isLoading,
  title,
  description,
  emptyTitle,
  emptyDescription,
  loadingLabel,
  statusLabel,
  createdAtLabel,
  getAssessmentHref,
  openAssessmentLabel,
}: AssessmentListProps) {
  return (
    <section
      id="assessments"
      className="scroll-mt-20 flex flex-col gap-4"
      aria-busy={isLoading}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1].map((item) => (
            <Card key={item} aria-label={loadingLabel}>
              <CardHeader>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && assessments.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {!isLoading && assessments.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assessments.map((assessment) => (
            <AssessmentSummaryCard
              key={assessment.id}
              assessment={assessment}
              statusLabel={statusLabel}
              createdAtLabel={createdAtLabel}
              href={getAssessmentHref?.(assessment)}
              openAssessmentLabel={openAssessmentLabel}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

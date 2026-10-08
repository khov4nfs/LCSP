"use client";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHeader,
  TableHead,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
} from "@/components/ui/field";
import { resolveAppMessage } from "@/lib/i18n";
import { canonicalExecutionLabel } from "@/features/workspace/utils/assessment-runtime-formatter";
import {
  useLegalPortfolioHistoryQuery,
  useStartLegalPreparationMutation,
} from "@/lib/api/legal-portfolio-queries";
import {
  legalPreparationFormSchema,
  type LegalPreparationFormValues,
} from "../../schemas/legal-preparation.schema";
import { AdminPageHeader } from "../molecules/admin-page-header";

export function LegalPortfolioHistory() {
  const history = useLegalPortfolioHistoryQuery();
  const prepare = useStartLegalPreparationMutation();
  const form = useForm<LegalPreparationFormValues>({
    resolver: zodResolver(legalPreparationFormSchema),
    defaultValues: { legalCorpusVersionId: "", idempotencyKey: "" },
  });
  if (history.isPending) return <Skeleton className="h-72 w-full" />;
  if (history.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveAppMessage("pages.agenticAssessment.requestFailed")}{" "}
          <Button variant="outline" onClick={() => void history.refetch()}>
            {resolveAppMessage("pages.agenticAssessment.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  const active = history.data.portfolios.find(
    (item) => item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  return (
    <div className="flex flex-col gap-6 pb-12">
      <AdminPageHeader
        title={resolveAppMessage("pages.legalPreparation.title")}
        description={resolveAppMessage("pages.legalPreparation.description")}
      />
      <p>
        {resolveAppMessage("pages.legalPreparation.active")}:{" "}
        {active?.version ??
          resolveAppMessage("pages.legalPreparation.unavailable")}
      </p>
      <form
        onSubmit={form.handleSubmit(async (value) => {
          await prepare.mutateAsync(value).catch(() => undefined);
        })}
        className="flex flex-col gap-4"
      >
        <FieldGroup>
          <Field
            data-invalid={Boolean(form.formState.errors.legalCorpusVersionId)}
          >
            <FieldLabel htmlFor="legal-corpus">
              {resolveAppMessage("pages.legalPreparation.corpus")}
            </FieldLabel>
            <Controller
              name="legalCorpusVersionId"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    form.setValue("idempotencyKey", crypto.randomUUID());
                  }}
                  disabled={prepare.isPending}
                >
                  <SelectTrigger
                    id="legal-corpus"
                    aria-invalid={Boolean(
                      form.formState.errors.legalCorpusVersionId,
                    )}
                  >
                    <SelectValue
                      placeholder={resolveAppMessage(
                        "pages.legalPreparation.selectCorpus",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {history.data.corpora.map((corpus) => (
                        <SelectItem
                          key={corpus.legalCorpusVersionId}
                          value={corpus.legalCorpusVersionId}
                        >
                          {corpus.version}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.legalCorpusVersionId ? (
              <FieldError>
                {resolveAppMessage("pages.legalPreparation.selectCorpus")}
              </FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          disabled={prepare.isPending || !history.data.corpora.length}
        >
          {resolveAppMessage(
            prepare.isPending
              ? "pages.legalPreparation.starting"
              : "pages.legalPreparation.start",
          )}
        </Button>
        {prepare.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {resolveAppMessage("pages.agenticAssessment.requestFailed")}
            </AlertDescription>
          </Alert>
        ) : null}
      </form>
      <section className="flex flex-col gap-3">
        <h2>{resolveAppMessage("pages.legalPreparation.history")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {resolveAppMessage("pages.legalPreparation.version")}
              </TableHead>
              <TableHead>
                {resolveAppMessage("pages.legalPreparation.state")}
              </TableHead>
              <TableHead>
                {resolveAppMessage("pages.legalPreparation.rules")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.portfolios.map((item) => (
              <TableRow key={item.portfolioVersionId}>
                <TableCell>{item.version}</TableCell>
                <TableCell>
                  {resolveAppMessage(
                    `pages.legalPreparation.states.${item.lifecycleState}`,
                  )}
                </TableCell>
                <TableCell>
                  {item.legalRuleCount} / {item.engineeringRuleCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="flex flex-col gap-3">
        <h2>{resolveAppMessage("pages.legalPreparation.runs")}</h2>
        <ul className="flex flex-col gap-2">
          {history.data.preparations.map((run) => (
            <li key={run.preparationRunId}>
              {new Date(run.createdAt).toLocaleString()} ·{" "}
              {canonicalExecutionLabel(run.executionState)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

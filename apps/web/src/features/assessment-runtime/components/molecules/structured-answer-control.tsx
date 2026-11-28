"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SendHorizontalIcon } from "lucide-react";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { CHOICE_BUTTON_LIMIT } from "../../config/structured-answer";
import {
  textAnswerFormSchema,
  type TextAnswerFormValues,
} from "../../schemas/structured-answer.schema";
import {
  STRUCTURED_ANSWER_MODES,
  type StructuredAnswerChoice,
  type StructuredAnswerControlProps,
} from "../../types/structured-answer.types";

const t = (key: string, values: Record<string, string | number> = {}) => {
  let text = resolveMessage(appLocale, key as MessageKey);
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
};

const EXCLUSIVE_CHOICE_VALUES = new Set([
  "none_of_these",
  "none_of_the_above",
]);
const EXCLUSIVE_CHOICE_LABELS = new Set([
  "none of these",
  "không có mục nào",
]);

function isExclusiveChoice(choice: StructuredAnswerChoice): boolean {
  if (choice.exclusive === true) return true;
  const normalizedValue = choice.value.trim().toLowerCase();
  const normalizedLabel = choice.label.trim().toLowerCase();
  return (
    /^none$/i.test(normalizedValue) ||
    EXCLUSIVE_CHOICE_VALUES.has(normalizedValue) ||
    EXCLUSIVE_CHOICE_LABELS.has(normalizedLabel)
  );
}

/**
 * Business purpose:
 * Toggle a multi-select option while enforcing mutual exclusivity for "None of these".
 *
 * Business rules:
 * - Selecting an exclusive option clears all other selected options.
 * - Selecting any non-exclusive option clears any selected exclusive option.
 * - Re-clicking an already selected option deselects it.
 *
 * Execution flow:
 * 1. If `choice.value` is already selected, remove it.
 * 2. If `choice` is exclusive, return `[choice.value]`.
 * 3. Otherwise append `choice.value` after filtering out exclusive choices.
 *
 * Failure cases:
 * - None; returns a new array without mutating inputs.
 *
 * Side effects:
 * - Pure state transition helper.
 */
export function toggleMultiSelectChoice(
  current: readonly string[],
  choice: StructuredAnswerChoice,
  allChoices: readonly StructuredAnswerChoice[],
): string[] {
  if (current.includes(choice.value)) {
    return current.filter((item) => item !== choice.value);
  }
  if (isExclusiveChoice(choice)) {
    return [choice.value];
  }
  const exclusiveValues = new Set(
    allChoices.filter(isExclusiveChoice).map((item) => item.value),
  );
  return [
    ...current.filter((item) => !exclusiveValues.has(item)),
    choice.value,
  ];
}

/**
 * Business purpose:
 * Render the shared typed Open Question answer control for Single-select, Multi-select,
 * Boolean (Yes/No), and Free-text human resolution requests.
 *
 * Business rules:
 * - Never auto-submits on option selection; requires explicit Submit action.
 * - Never preselects demo answers.
 * - Displays selection count for Single-select and Multi-select.
 * - Enforces mutually exclusive "None of these" in Multi-select.
 * - Treats Boolean `false` as a valid explicit answer, distinct from "I don't know".
 * - Preserves unsent user input on submission failure or stale conflict.
 *
 * Execution flow:
 * 1. Dispatch to `ChoiceAnswer`, `MultiChoiceAnswer`, `BooleanAnswer`, or `TextAnswer` by `mode`.
 * 2. Provide an explicit `"I don't know"` action alongside explicit submit.
 * 3. Render `staleConflict` or `failed` alert banners when flagged.
 *
 * Failure cases:
 * - Empty or invalid selections keep the Submit button disabled.
 *
 * Side effects:
 * - Invokes `onSubmit(answer)` only on explicit user submission or "I don't know" click.
 */
export function StructuredAnswerControl(props: StructuredAnswerControlProps) {
  const unavailable = props.disabled || props.pending;
  const unknown = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={unavailable}
      onClick={() => props.onSubmit({ doesNotKnow: true })}
    >
      {t("pages.assessmentConversation.answer.unknown")}
    </Button>
  );
  return (
    <div
      data-slot="structured-answer-control"
      data-answer-mode={props.mode}
      aria-busy={props.pending ? true : undefined}
      className="flex flex-col gap-2.5"
    >
      {props.mode === STRUCTURED_ANSWER_MODES.CHOICE ? (
        <ChoiceAnswer {...props} unknown={unknown} />
      ) : props.mode === STRUCTURED_ANSWER_MODES.MULTI_CHOICE ? (
        <MultiChoiceAnswer {...props} unknown={unknown} />
      ) : props.mode === STRUCTURED_ANSWER_MODES.BOOLEAN ? (
        <BooleanAnswer {...props} unknown={unknown} />
      ) : (
        <TextAnswer {...props} unknown={unknown} />
      )}
      {props.staleConflict ? (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {t("pages.assessmentConversation.answer.staleConflict")}
        </p>
      ) : props.failed ? (
        <p role="alert" className="text-xs text-destructive">
          {t("pages.assessmentConversation.answer.failed")}
        </p>
      ) : null}
    </div>
  );
}

type ShapeProps = StructuredAnswerControlProps & {
  unknown: React.ReactNode;
};

function ChoiceAnswer(props: ShapeProps) {
  const [picked, setPicked] = useState("");
  const unavailable = props.disabled || props.pending;
  const selectedCount = picked === "" ? 0 : 1;

  if (props.choices.length > CHOICE_BUTTON_LIMIT) {
    return (
      <div className="flex flex-col gap-2.5">
        <Select
          value={picked}
          onValueChange={(value) => setPicked(value ?? "")}
          disabled={unavailable}
        >
          <SelectTrigger
            id={`${props.idBase}-select`}
            aria-label={t("pages.assessmentConversation.answer.selectOne")}
            className="w-full sm:w-72"
          >
            <SelectValue
              placeholder={t("pages.assessmentConversation.answer.selectOne")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("pages.assessmentConversation.answer.selectOneCount", {
            count: selectedCount,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={unavailable || picked === ""}
            onClick={() =>
              props.onSubmit({ doesNotKnow: false, answer: picked })
            }
          >
            {t("pages.assessmentConversation.answer.submitAnswer")}
          </Button>
          {props.unknown}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("pages.assessmentConversation.answer.linkedNote")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <RadioGroup
        value={picked}
        onValueChange={(value) => setPicked(String(value ?? ""))}
        disabled={unavailable}
        aria-label={t("pages.assessmentConversation.answer.selectOne")}
      >
        {props.choices.map((choice) => {
          const id = `${props.idBase}-${choice.value}`;
          const selected = picked === choice.value;
          return (
            <label
              key={choice.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent/40",
                unavailable && "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem id={id} value={choice.value} />
              <span>{choice.label}</span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.selectOneCount", {
          count: selectedCount,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={unavailable || picked === ""}
          onClick={() =>
            props.onSubmit({ doesNotKnow: false, answer: picked })
          }
        >
          {t("pages.assessmentConversation.answer.submitAnswer")}
        </Button>
        {props.unknown}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.linkedNote")}
      </p>
    </div>
  );
}

function BooleanAnswer(props: ShapeProps) {
  const [picked, setPicked] = useState("");
  const unavailable = props.disabled || props.pending;
  const booleanChoices: readonly StructuredAnswerChoice[] =
    props.choices.length >= 2
      ? props.choices
      : [
          { value: "true", label: t("pages.assessmentConversation.answer.yes") },
          { value: "false", label: t("pages.assessmentConversation.answer.no") },
        ];

  return (
    <div className="flex flex-col gap-2.5">
      <RadioGroup
        value={picked}
        onValueChange={(value) => setPicked(String(value ?? ""))}
        disabled={unavailable}
        aria-label={t("pages.assessmentConversation.answer.typeBoolean")}
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
      >
        {booleanChoices.map((choice) => {
          const id = `${props.idBase}-${choice.value}`;
          const selected = picked === choice.value;
          return (
            <label
              key={choice.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent/40",
                unavailable && "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem id={id} value={choice.value} />
              <span>{choice.label}</span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.booleanHint")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={unavailable || picked === ""}
          onClick={() =>
            props.onSubmit({ doesNotKnow: false, answer: picked })
          }
        >
          {t("pages.assessmentConversation.answer.submitAnswer")}
        </Button>
        {props.unknown}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.linkedNote")}
      </p>
    </div>
  );
}

function MultiChoiceAnswer(props: ShapeProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const unavailable = props.disabled || props.pending;
  const toggle = (choice: StructuredAnswerChoice) =>
    setPicked((current) =>
      toggleMultiSelectChoice(current, choice, props.choices),
    );

  return (
    <fieldset className="flex flex-col gap-2.5" disabled={unavailable}>
      <legend className="sr-only">
        {t("pages.assessmentConversation.answer.selectMany")}
      </legend>
      {props.choices.map((choice) => {
        const id = `${props.idBase}-${choice.value}`;
        const checked = picked.includes(choice.value);
        return (
          <label
            key={choice.value}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              checked
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-card text-foreground hover:bg-accent/40",
              unavailable && "cursor-not-allowed opacity-60",
            )}
          >
            <Checkbox
              id={id}
              checked={checked}
              disabled={unavailable}
              onCheckedChange={() => toggle(choice)}
            />
            <span>{choice.label}</span>
          </label>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.selectManyCount", {
          count: picked.length,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={unavailable || picked.length === 0}
          onClick={() =>
            props.onSubmit({
              doesNotKnow: false,
              answer: props.choices
                .filter((choice) => picked.includes(choice.value))
                .map((choice) => choice.value)
                .join(", "),
            })
          }
        >
          {t("pages.assessmentConversation.answer.submitAnswer")}
        </Button>
        {props.unknown}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("pages.assessmentConversation.answer.linkedNote")}
      </p>
    </fieldset>
  );
}

function TextAnswer(props: ShapeProps) {
  const form = useForm<TextAnswerFormValues>({
    resolver: zodResolver(textAnswerFormSchema),
    defaultValues: { answer: "" },
  });
  const unavailable = props.disabled || props.pending;
  const id = `${props.idBase}-text`;
  const invalid = Boolean(form.formState.errors.answer);
  const submit = form.handleSubmit((values) =>
    props.onSubmit({ doesNotKnow: false, answer: values.answer }),
  );
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
        <label htmlFor={id} className="sr-only">
          {t("pages.assessmentConversation.answer.textLabel")}
        </label>
        <Textarea
          id={id}
          rows={2}
          disabled={unavailable}
          aria-invalid={invalid}
          placeholder={t("pages.assessmentConversation.answer.textLabel")}
          className="min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          {...form.register("answer")}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={unavailable}
          aria-label={t(
            props.pending
              ? "pages.assessmentConversation.answer.sending"
              : "pages.assessmentConversation.answer.send",
          )}
        >
          <SendHorizontalIcon aria-hidden="true" />
        </Button>
      </div>
      {invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {t("pages.assessmentConversation.answer.required")}
        </p>
      ) : null}
      <div>{props.unknown}</div>
    </form>
  );
}

"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SendHorizontalIcon } from "lucide-react";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
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
import { CHOICE_BUTTON_LIMIT } from "../../config/structured-answer";
import {
  textAnswerFormSchema,
  type TextAnswerFormValues,
} from "../../schemas/structured-answer.schema";
import {
  STRUCTURED_ANSWER_MODES,
  type StructuredAnswerControlProps,
} from "../../types/structured-answer.types";

const t = (key: string) => resolveMessage(appLocale, key as MessageKey);

/**
 * The one answer control of the conversation: choice buttons (Yes / No / …), a select for long
 * lists, selectable options with an explicit submit, or a composer-style text field. Every shape
 * offers an honest "I don't know" and never asks for free text where a choice is expected.
 */
export function StructuredAnswerControl(props: StructuredAnswerControlProps) {
  const unavailable = props.disabled || props.pending;
  const unknown = (
    <Button
      type="button"
      variant="ghost"
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
      className="flex flex-col gap-2"
    >
      {props.mode === STRUCTURED_ANSWER_MODES.CHOICE ? (
        <ChoiceAnswer {...props} unknown={unknown} />
      ) : props.mode === STRUCTURED_ANSWER_MODES.MULTI_CHOICE ? (
        <MultiChoiceAnswer {...props} unknown={unknown} />
      ) : (
        <TextAnswer {...props} unknown={unknown} />
      )}
      {props.failed ? (
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
  if (props.choices.length > CHOICE_BUTTON_LIMIT)
    return (
      <div className="flex flex-wrap items-center gap-2">
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
        <Button
          type="button"
          size="sm"
          disabled={unavailable || picked === ""}
          onClick={() =>
            props.onSubmit({ doesNotKnow: false, answer: picked })
          }
        >
          {t("pages.assessmentConversation.answer.submit")}
        </Button>
        {props.unknown}
      </div>
    );
  return (
    <div
      role="group"
      aria-label={t("pages.assessmentConversation.answer.selectOne")}
      className="flex flex-wrap items-center gap-2"
    >
      {props.choices.map((choice) => (
        <Button
          key={choice.value}
          type="button"
          variant="outline"
          size="sm"
          disabled={unavailable}
          onClick={() =>
            props.onSubmit({ doesNotKnow: false, answer: choice.value })
          }
        >
          {choice.label}
        </Button>
      ))}
      {props.unknown}
    </div>
  );
}

function MultiChoiceAnswer(props: ShapeProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const unavailable = props.disabled || props.pending;
  const toggle = (value: string) =>
    setPicked((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  return (
    <fieldset className="flex flex-col gap-2" disabled={unavailable}>
      <legend className="sr-only">
        {t("pages.assessmentConversation.answer.selectMany")}
      </legend>
      {props.choices.map((choice) => {
        const id = `${props.idBase}-${choice.value}`;
        return (
          <label
            key={choice.value}
            htmlFor={id}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              id={id}
              type="checkbox"
              checked={picked.includes(choice.value)}
              onChange={() => toggle(choice.value)}
              className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            {choice.label}
          </label>
        );
      })}
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
          {t("pages.assessmentConversation.answer.submit")}
        </Button>
        {props.unknown}
      </div>
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

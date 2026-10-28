"use client";

import {
  Controller,
  useFormContext,
  type FieldValues,
  type Path,
} from "react-hook-form";
import type { MessageKey } from "@lcsp/i18n";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";

const t = (key: string) => resolveAppMessage(key as MessageKey);

type FieldProps<TValues extends FieldValues> = {
  name: Path<TValues>;
  labelKey: string;
  placeholderKey?: string;
  helperKey?: string;
  type?: string;
  multiline?: boolean;
  disabled?: boolean;
  id: string;
};

export function LegalSourceTextField<TValues extends FieldValues>({
  name,
  labelKey,
  placeholderKey,
  helperKey,
  type,
  multiline,
  disabled,
  id,
}: FieldProps<TValues>) {
  const { register, getFieldState, formState } = useFormContext<TValues>();
  const error = getFieldState(name, formState).error?.message;
  const describedBy = error
    ? `${id}-error`
    : helperKey
      ? `${id}-helper`
      : undefined;
  const common = {
    id,
    ...register(name),
    placeholder: placeholderKey ? t(placeholderKey) : undefined,
    disabled,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      {multiline ? (
        <textarea
          {...common}
          className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      ) : (
        <Input {...common} type={type ?? "text"} />
      )}
      {helperKey ? (
        <p id={`${id}-helper`} className="text-sm text-muted-foreground">
          {t(helperKey)}
        </p>
      ) : null}
      {typeof error === "string" ? (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

type Option = { value: string; labelKey?: string; label?: string };

export function LegalSourceSelectField<TValues extends FieldValues>({
  name,
  labelKey,
  options,
  helperKey,
  id,
}: {
  name: Path<TValues>;
  labelKey: string;
  options: Option[];
  helperKey?: string;
  id: string;
}) {
  const { register, getFieldState, formState } = useFormContext<TValues>();
  const error = getFieldState(name, formState).error?.message;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <select
        id={id}
        {...register(name)}
        aria-invalid={Boolean(error)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label ?? (option.labelKey ? t(option.labelKey) : "")}
          </option>
        ))}
      </select>
      {helperKey ? (
        <p className="text-sm text-muted-foreground">{t(helperKey)}</p>
      ) : null}
      {typeof error === "string" ? (
        <p className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

export function LegalSourceFileField<TValues extends FieldValues>({
  name,
  labelKey,
  helperKey,
  helperValues,
  accept,
  id,
}: {
  name: Path<TValues>;
  labelKey: string;
  helperKey: string;
  helperValues?: Record<string, string | number>;
  accept: string;
  id: string;
}) {
  const { control, getFieldState, formState } = useFormContext<TValues>();
  const error = getFieldState(name, formState).error?.message;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Input
            id={id}
            type="file"
            accept={accept}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(event.currentTarget.files?.[0])}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : `${id}-helper`}
          />
        )}
      />
      <p id={`${id}-helper`} className="text-sm text-muted-foreground">
        {helperValues
          ? formatAppMessage(helperKey as MessageKey, helperValues)
          : t(helperKey)}
      </p>
      {typeof error === "string" ? (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

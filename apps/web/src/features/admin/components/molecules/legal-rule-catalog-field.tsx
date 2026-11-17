"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

export function LegalRuleCatalogField({
  name,
  label,
  multiline = false,
  readOnly = false,
}: {
  name: string;
  label: string;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[name]?.message;
  const props = {
    ...register(name),
    id: `catalog-${name}`,
    readOnly,
    "aria-invalid": !!error,
    "aria-describedby": error ? `catalog-${name}-error` : undefined,
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor={props.id}>{t(label)}</Label>
      {multiline ? <Textarea {...props} rows={4} /> : <Input {...props} />}
      {typeof error === "string" ? (
        <p
          id={`catalog-${name}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

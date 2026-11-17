import type { MessageKey } from "@lcsp/i18n";
import type { FieldValues, Path } from "react-hook-form";
import type { ReactNode } from "react";

export type FormTextFieldProps<T extends FieldValues> = {
  name: Path<T>;
  id: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  autoComplete?: string;
  inputClassName?: string;
  actions?: ReactNode;
};

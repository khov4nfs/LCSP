import type { MessageKey } from "@lcsp/i18n";
import type { FieldValues, Path } from "react-hook-form";
import type { HTMLInputTypeAttribute, ReactNode } from "react";

export type FormTextFieldProps<T extends FieldValues> = {
  name: Path<T>;
  id: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  autoComplete?: string;
  type?: HTMLInputTypeAttribute;
  inputClassName?: string;
  actions?: ReactNode;
  /** Lets a domain screen move secondary actions below an editable field at narrow widths. */
  wrapActions?: boolean;
};

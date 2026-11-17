import type { MessageKey } from "@lcsp/i18n";
import type { FieldValues, Path } from "react-hook-form";

export type FormSelectOption = {
  value: string;
  labelKey: MessageKey;
};

export type FormSelectFieldProps<T extends FieldValues> = {
  name: Path<T>;
  id: string;
  labelKey: MessageKey;
  options: readonly FormSelectOption[];
};

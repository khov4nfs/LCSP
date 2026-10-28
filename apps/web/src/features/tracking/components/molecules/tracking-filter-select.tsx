"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRACKING_FILTER_ALL_VALUE } from "../../config/tracking-ui.config";
import type { TrackingFilterSelectProps } from "../../types/tracking-ui.types";

export function TrackingFilterSelect({
  id,
  label,
  placeholder,
  value,
  options,
  onValueChange,
  className,
}: TrackingFilterSelectProps) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || TRACKING_FILTER_ALL_VALUE}
        onValueChange={(selectedValue) => {
          onValueChange(
            !selectedValue || selectedValue === TRACKING_FILTER_ALL_VALUE
              ? ""
              : selectedValue,
          );
        }}
      >
        <SelectTrigger id={id} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TRACKING_FILTER_ALL_VALUE}>
            {placeholder}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AuthFormSurface({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-[360px] flex-col", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AuthHeading({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[450px] max-w-[calc(100vw-48px)] self-center text-center",
        className,
      )}
    >
      <h1 className="text-[34px] font-semibold leading-[48px] text-[#2d2d2a]">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-[450px] text-sm leading-[22px] text-[#5f5f5a]">
        {description}
      </p>
    </div>
  );
}

export function AuthTextField({
  id,
  label,
  description,
  error,
  className,
  inputClassName,
  trailing,
  ...inputProps
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  description: string;
  error?: string;
  inputClassName?: string;
  trailing?: ReactNode;
}) {
  return (
    <Field
      data-invalid={Boolean(error) || undefined}
      className={cn("gap-1.5", className)}
    >
      <FieldLabel htmlFor={id} className="text-xs font-medium text-[#2d2d2a]">
        {label}
      </FieldLabel>
      <div className="relative">
        <Input
          id={id}
          aria-invalid={Boolean(error)}
          className={cn(
            "h-10 rounded-lg border-[#d8d8d3] bg-white px-3 py-0 text-[13px] text-[#2d2d2a] shadow-none placeholder:text-[#7a7a74] focus-visible:border-[#0e7c66] focus-visible:ring-2 focus-visible:ring-[#0e7c66]/20 md:text-[13px]",
            trailing ? "pr-24" : undefined,
            inputClassName,
          )}
          {...inputProps}
        />
        {trailing ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] leading-none text-[#7a7a74]">
            {trailing}
          </span>
        ) : null}
      </div>
      {error ? (
        <FieldError className="text-[11px] leading-normal">{error}</FieldError>
      ) : (
        <FieldDescription className="text-[11px] leading-normal text-[#7a7a74]">
          {description}
        </FieldDescription>
      )}
    </Field>
  );
}

export function AuthPrimaryButton({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-9 w-full rounded-lg border-[#2d2d2a] bg-[#2d2d2a] px-[14px] text-[13px] font-medium leading-none text-[#f7f7f5] hover:bg-[#2d2d2a]/90",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function AuthSecondaryButton({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-9 w-full rounded-lg border-[#d8d8d3] bg-white px-[14px] text-[13px] font-medium leading-none text-[#2d2d2a] hover:bg-white",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex h-5 items-center gap-2.5">
      <span className="h-px flex-1 bg-[#e3e3de]" />
      <span className="text-[11px] leading-none text-[#7a7a74]">{label}</span>
      <span className="h-px flex-1 bg-[#e3e3de]" />
    </div>
  );
}

export function AuthInlineLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "text-[11px] font-medium leading-4 text-[#0e7c66] underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function AuthNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-center text-[10px] leading-normal text-[#7a7a74]",
        className,
      )}
    >
      {children}
    </p>
  );
}

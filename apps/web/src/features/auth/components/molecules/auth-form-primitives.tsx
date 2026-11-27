"use client";

import Link from "next/link";
import { useState, type ComponentProps, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useAppLocale } from "@/components/providers/locale-provider";

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
  // The Figma form column is 450px; max-width keeps the same surface usable in the narrower responsive column.
  return (
    <div
      className={cn("mx-auto flex w-full max-w-[450px] flex-col", className)}
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
  titleClassName,
}: {
  title: string;
  description: string;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div
      className={cn(
        "w-full self-start text-left",
        className,
      )}
    >
      {/* The audited form title uses a 42px/42px scale; no existing shared semantic token matches it. */}
      <h1 className={cn("text-[42px] leading-[42px] font-semibold tracking-tight text-foreground", titleClassName)}>
        {title}
      </h1>
      <p className="mt-2 max-w-[450px] text-sm leading-6 text-muted-foreground">
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
  descriptionClassName,
  className,
  inputClassName,
  trailing,
  type,
  ...inputProps
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  description: string;
  error?: string;
  descriptionClassName?: string;
  inputClassName?: string;
  trailing?: ReactNode;
}) {
  // Read the shared locale reactively so the visibility label updates without resetting the registered input.
  const locale = useAppLocale();
  const isPasswordField = type === "password";
  const [showPassword, setShowPassword] = useState(false);
  const resolvedType = isPasswordField
    ? showPassword
      ? "text"
      : "password"
    : type;
  // Give the active helper or validation message a stable field-relative ID so SR-only hints and visible errors stay associated.
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const ariaDescribedBy = [
    inputProps["aria-describedby"],
    error ? errorId : descriptionId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Field
      data-invalid={Boolean(error) || undefined}
      className={cn("gap-2", className)}
    >
      <FieldLabel htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </FieldLabel>
      <div className="relative">
        {/* The audited border was only 1.71:1 and the shared 20% focus halo lacked contrast; auth-local values clear 3:1 without changing shared input tokens. */}
        <Input
          id={id}
          type={resolvedType}
          className={cn(
            "h-9 rounded-sm border-[#7B8A98] bg-white px-3 py-0 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
            isPasswordField && trailing
              ? "pr-32"
              : isPasswordField
                ? "pr-10"
                : trailing
                  ? "pr-24"
                  : undefined,
            inputClassName,
          )}
          {...inputProps}
          aria-describedby={ariaDescribedBy || undefined}
          aria-invalid={Boolean(error)}
        />
        {trailing ? (
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs leading-none text-muted-foreground",
              isPasswordField ? "right-10" : "right-3",
            )}
          >
            {trailing}
          </span>
        ) : null}
        {isPasswordField ? (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={resolveMessage(
              locale,
              (showPassword
                ? "pages.signIn.hidePassword"
                : "pages.signIn.showPassword") as MessageKey,
            )}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showPassword ? (
              <EyeOffIcon className="size-4" aria-hidden="true" />
            ) : (
              <EyeIcon className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      {error ? (
        <FieldError id={errorId} className="text-xs leading-normal">
          {error}
        </FieldError>
      ) : (
        <FieldDescription
          id={descriptionId}
          className={cn(
            "text-xs leading-normal text-muted-foreground",
            // The shared Field sets direct sr-only children to width:auto; cap this auth-only hint so enlarged VI copy cannot widen the document.
            descriptionClassName?.split(/\s+/).includes("sr-only")
              ? "max-w-px"
              : undefined,
            descriptionClassName,
          )}
        >
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
      // Keep the Figma-specific scale and opaque focus ring in the auth wrapper instead of changing the shared M24 Button primitive.
  return (
    <Button
      className={cn(
        "h-10 w-full rounded-sm border-[#123E46] bg-[#123E46] px-4 text-sm font-medium leading-none text-white focus-visible:ring-ring hover:bg-[#11545B]",
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
      // Keep the secondary action and opaque focus ring module-local rather than changing the shared M24 Button primitive.
  return (
    <Button
      variant="outline"
      className={cn(
        "h-10 w-full rounded-sm border-input bg-card px-4 text-sm font-medium leading-none text-card-foreground focus-visible:ring-ring hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function AuthDivider({ label }: { label: string }) {
  // Use the shared readable auth text scale for the separator label in both supported locales.
  return (
    <div className="flex h-5 items-center gap-2.5">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs leading-none text-muted-foreground">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function AuthInlineLink({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  // Keep auth navigation visually consistent while preserving the existing semantic link destination.
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
            // Keep standalone auth navigation links at the WCAG 2.2 AA 24px target while preserving their link role.
            "inline-flex min-h-6 items-center text-xs font-medium leading-4 text-brand underline-offset-4 hover:underline",
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
  // Keep helper copy within the auth module's readable 12px text scale.
  return (
    <p
      className={cn(
        "text-center text-xs leading-normal text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

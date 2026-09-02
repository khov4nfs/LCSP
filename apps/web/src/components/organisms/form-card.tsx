import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { FormCardProps } from "../types/form-card.types";

export function FormCard({
  eyebrow,
  title,
  description,
  leading,
  children,
  footer,
}: FormCardProps) {
  return (
    <Card className="w-full max-w-none border-0 bg-transparent py-0 shadow-none">
      <CardHeader className="px-0 text-center">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
        <CardDescription className="mx-auto max-w-sm leading-6">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-0">
        {leading}
        {children}
      </CardContent>
      <CardFooter className="flex-col gap-3 px-0">{footer}</CardFooter>
    </Card>
  );
}

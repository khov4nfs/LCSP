"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  feedbackFormSchema,
  FEEDBACK_CATEGORIES,
  type FeedbackFormValues,
} from "../schemas/feedback.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { StarIcon, CheckCircle2Icon } from "lucide-react";

export function FeedbackForm() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: {
      name: "",
      email: "",
      category: "product",
      rating: 5,
      message: "",
    },
  });

  const selectedRating = watch("rating");

  const onSubmit = async (_data: FeedbackFormValues) => {
    // Client-side fallback state since no backend feedback endpoint exists yet
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSubmitted(true);
  };

  const handleReset = () => {
    reset();
    setSubmitted(false);
  };

  return (
    <section
      data-section="feedback-form"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[120px]"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {t("pages.marketing.home.feedbackEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("pages.marketing.home.feedbackTitle")}
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          {t("pages.marketing.home.feedbackDescription")}
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
        {submitted ? (
          <div className="flex flex-col items-center py-8 text-center" data-testid="feedback-success">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-8" />
            </div>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {t("pages.marketing.home.feedbackSuccessTitle")}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-md">
              {t("pages.marketing.home.feedbackSuccessDescription")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              className="mt-6 text-xs"
            >
              {t("pages.marketing.home.feedbackSendAnother")}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="feedback-name" className="text-xs font-medium text-foreground">
                {t("pages.marketing.home.feedbackNameLabel")}
              </Label>
              <Input
                id="feedback-name"
                placeholder={t("pages.marketing.home.feedbackNamePlaceholder")}
                disabled={isSubmitting}
                aria-invalid={!!errors.name}
                {...register("name")}
              />
              {errors.name?.message && (
                <p className="text-xs text-destructive">{t(errors.name.message)}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="feedback-email" className="text-xs font-medium text-foreground">
                {t("pages.marketing.home.feedbackEmailLabel")}
              </Label>
              <Input
                id="feedback-email"
                type="email"
                placeholder={t("pages.marketing.home.feedbackEmailPlaceholder")}
                disabled={isSubmitting}
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              {errors.email?.message && (
                <p className="text-xs text-destructive">{t(errors.email.message)}</p>
              )}
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label htmlFor="feedback-category" className="text-xs font-medium text-foreground">
                {t("pages.marketing.home.feedbackCategoryLabel")}
              </Label>
              <select
                id="feedback-category"
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                {...register("category")}
              >
                {FEEDBACK_CATEGORIES.map((cat) => {
                  const labelKey = `pages.marketing.home.feedbackCategory${
                    cat.charAt(0).toUpperCase() + cat.slice(1)
                  }`;
                  return (
                    <option key={cat} value={cat} className="bg-popover text-popover-foreground">
                      {t(labelKey)}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Rating Stars */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">
                {t("pages.marketing.home.feedbackRatingLabel")}
              </Label>
              <div className="flex items-center gap-1.5 pt-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setValue("rating", star, { shouldValidate: true })}
                    className="p-1 text-muted-foreground transition-colors hover:text-amber-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                    aria-label={`${star} star`}
                  >
                    <StarIcon
                      className={`size-5 ${
                        star <= (selectedRating ?? 5)
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div className="space-y-1.5">
              <Label htmlFor="feedback-message" className="text-xs font-medium text-foreground">
                {t("pages.marketing.home.feedbackMessageLabel")}
              </Label>
              <Textarea
                id="feedback-message"
                rows={4}
                placeholder={t("pages.marketing.home.feedbackMessagePlaceholder")}
                disabled={isSubmitting}
                aria-invalid={!!errors.message}
                {...register("message")}
              />
              {errors.message?.message && (
                <p className="text-xs text-destructive">{t(errors.message.message)}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full text-xs font-medium"
            >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2" />
                  {t("pages.marketing.home.feedbackSubmittingButton")}
                </>
              ) : (
                t("pages.marketing.home.feedbackSubmitButton")
              )}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

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
import { MessageSquareIcon, CheckCircle2Icon } from "lucide-react";

export function FigmaFeedbackSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: {
      name: "Anonymous User",
      email: "",
      category: "product",
      rating: 5,
      message: "",
    },
  });

  const onSubmit = async (_data: FeedbackFormValues) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSubmitted(true);
  };

  return (
    <section
      id="feedback"
      data-section="figma-feedback"
      className="w-full bg-[#EEF2F8] py-20 text-[#101C29]"
    >
      <div className="mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="grid gap-12 lg:grid-cols-[450px_1fr]">
          {/* Left Column: Title & Guidance Box */}
          <div>
            <p className="text-xs font-semibold tracking-wider text-[#11545B]">
              {t("pages.marketing.home.feedbackSectionEyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
              {t("pages.marketing.home.feedbackSectionTitle")}
            </h2>
            <p className="mt-3 text-base text-[#48586A]">
              {t("pages.marketing.home.feedbackSectionDescription")}
            </p>

            {/* Guidance Box (Figma #1767:13011) */}
            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center gap-3 text-[#101C29]">
                <MessageSquareIcon className="size-5 text-[#31BDA7]" />
                <h3 className="text-base font-semibold">
                  {t("pages.marketing.home.feedbackGuidanceTitle")}
                </h3>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.feedbackGuidanceDescription")}
              </p>
            </div>
          </div>

          {/* Right Column: Feedback Form Card (Figma #1767:13016) */}
          <div className="rounded-[20px] border border-slate-200 bg-white p-8 shadow-md">
            <h3 className="text-xl font-semibold text-[#101C29]">
              {t("pages.marketing.home.feedbackFormCardTitle")}
            </h3>

            {submitted ? (
              <div className="mt-6 flex flex-col items-center py-8 text-center">
                <CheckCircle2Icon className="size-12 text-[#31BDA7]" />
                <h4 className="mt-3 text-lg font-semibold text-[#101C29]">
                  {t("pages.marketing.home.feedbackSuccessTitle")}
                </h4>
                <p className="mt-1 text-xs text-[#48586A]">
                  {t("pages.marketing.home.feedbackSuccessDescription")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setSubmitted(false);
                  }}
                  className="mt-5 text-xs"
                >
                  {t("pages.marketing.home.feedbackSendAnother")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
                {/* Category Dropdown */}
                <div>
                  <label htmlFor="fb-category" className="block text-xs font-semibold text-[#101C29]">
                    {t("pages.marketing.home.feedbackCategoryDropdownLabel")}
                  </label>
                  <select
                    id="fb-category"
                    disabled={isSubmitting}
                    className="mt-1.5 flex h-10 w-full rounded-[7px] border border-slate-300 bg-white px-3 text-xs text-[#101C29] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#31BDA7]"
                    {...register("category")}
                  >
                    {FEEDBACK_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === "product"
                          ? t("pages.marketing.home.feedbackCategoryProduct")
                          : cat === "compliance"
                          ? t("pages.marketing.home.feedbackCategoryCompliance")
                          : cat === "integration"
                          ? t("pages.marketing.home.feedbackCategoryIntegration")
                          : t("pages.marketing.home.feedbackCategoryOther")}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Email (optional) */}
                <div>
                  <label htmlFor="fb-email" className="block text-xs font-semibold text-[#101C29]">
                    {t("pages.marketing.home.feedbackEmailFieldLabel")}
                  </label>
                  <Input
                    id="fb-email"
                    type="email"
                    placeholder={t("pages.marketing.home.feedbackEmailFieldPlaceholder")}
                    disabled={isSubmitting}
                    className="mt-1.5 h-10 rounded-[7px] border-slate-300 text-xs"
                    {...register("email")}
                  />
                  {errors.email?.message && (
                    <p className="mt-1 text-xs text-rose-500">{t(errors.email.message)}</p>
                  )}
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="fb-message" className="block text-xs font-semibold text-[#101C29]">
                    {t("pages.marketing.home.feedbackMessageFieldLabel")}
                  </label>
                  <Textarea
                    id="fb-message"
                    rows={4}
                    placeholder={t("pages.marketing.home.feedbackMessageFieldPlaceholder")}
                    disabled={isSubmitting}
                    className="mt-1.5 rounded-[7px] border-slate-300 text-xs"
                    {...register("message")}
                  />
                  {errors.message?.message && (
                    <p className="mt-1 text-xs text-rose-500">{t(errors.message.message)}</p>
                  )}
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-10 rounded-[7px] bg-[#0A2633] px-6 text-xs font-semibold text-white transition-all duration-200 hover:bg-[#113a4b] hover:shadow-md active:scale-95"
                  >
                    {isSubmitting
                      ? t("pages.marketing.home.feedbackSendingButton")
                      : t("pages.marketing.home.feedbackSendButton")}
                  </Button>
                </div>

                <p className="text-[11px] text-[#48586A]">
                  {t("pages.marketing.home.feedbackDisclaimer")}
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

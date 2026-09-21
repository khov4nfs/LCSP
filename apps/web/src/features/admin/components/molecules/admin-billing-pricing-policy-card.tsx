import { resolveAppMessage } from "@/lib/i18n";

export function AdminBillingPricingPolicyCard() {
  return (
    <section className="min-h-60 rounded-xl border border-border bg-card p-5 shadow-xs">
      <h2 className="text-lg font-semibold text-foreground">
        {resolveAppMessage("pages.admin.billing.pricing.title")}
      </h2>
      <div className="mt-3 space-y-1.5 text-sm leading-5 text-muted-foreground">
        <p>{resolveAppMessage("pages.admin.billing.pricing.providerCost")}</p>
        <p className="text-foreground">
          {resolveAppMessage("pages.admin.billing.pricing.customerCharge")}
        </p>
        <p>{resolveAppMessage("pages.admin.billing.pricing.prepaidCredits")}</p>
        <p className="pt-4">
          {resolveAppMessage("pages.admin.billing.pricing.missingSnapshot")}
        </p>
      </div>
    </section>
  );
}

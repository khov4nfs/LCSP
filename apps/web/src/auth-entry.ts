import { type AppProblem } from "@lcsp/contracts/auth";
import { type Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

export const PUBLIC_ENTRY_ROUTES = Object.freeze({
  signIn: "/sign-in",
  register: "/register",
});

type BlockedApiResult = {
  ok: false;
  problem: AppProblem;
};

export function buildBlockedAuthViewModel(
  apiResult: BlockedApiResult | null | undefined,
  locale: Locale = "vi",
) {
  if (apiResult?.ok) {
    return null;
  }

  const problem = apiResult?.problem;

  return {
    title: problem
      ? resolveMessage(locale, problem.titleKey)
      : resolveMessage(locale, "auth.errors.validationFailed.title"),
    body: problem ? resolveMessage(locale, problem.detailKey) : null,
    required_action: problem?.requiredAction,
    correlationId: problem?.correlationId,
  };
}

import { GetGapRequirementsHandler } from "./application/queries/get-gap-requirements/get-gap-requirements.handler.js";
import { GapRequirementsController } from "./presentation/http/gap-requirements.controller.js";

export const GAP_REQUIREMENTS_CONTROLLERS = [
  GapRequirementsController,
] as const;

export const GAP_REQUIREMENTS_PROVIDERS = [GetGapRequirementsHandler] as const;

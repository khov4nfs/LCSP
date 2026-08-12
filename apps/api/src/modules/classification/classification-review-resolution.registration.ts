import { ResolveClassificationReviewHandler } from "./application/commands/resolve-classification-review/resolve-classification-review.handler.js";
import { ClassificationReviewResolutionController } from "./presentation/http/classification-review-resolution.controller.js";

export const CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS = [
  ClassificationReviewResolutionController,
] as const;

export const CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS = [
  ResolveClassificationReviewHandler,
] as const;

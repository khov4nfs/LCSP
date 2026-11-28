// Why: List reads need a bounded rule window while selection and activation still require the complete catalog.
// How: The optional window is applied only to the Prisma rule relation inside the shared projection.
// Invariant: The caller retains one RepeatableRead snapshot across all windows.
export type LegalRuleProjectionWindow = Readonly<{
  skip: number;
  take: number;
}>;

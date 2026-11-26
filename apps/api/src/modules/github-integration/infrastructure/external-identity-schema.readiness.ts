import type { PrismaService } from "../../../infrastructure/prisma/prisma.service.js";

/**
 * Business purpose: Confirm that provider credential records can persist exact external identities before new REST providers are enabled.
 * Business rules: Activation requires nullable BigInt legacy identity storage, nullable text external identity storage, and the migration's provider-specific identity constraint in the active database schema.
 * Execution flow: 1. Read the two credential column definitions from the current PostgreSQL schema. 2. Verify their types and nullability. 3. Confirm the identity constraint exists on the credential table.
 * Failure cases: Missing, incompatible, or inaccessible schema metadata returns false so target providers remain unavailable.
 * Side effects: Performs read-only catalog queries against the configured application database.
 */
export async function isExternalIdentitySchemaCompatible(
  prisma: PrismaService,
): Promise<boolean> {
  try {
    const columns = await prisma.$queryRaw<
      Array<{ columnName: string; dataType: string; isNullable: string }>
    >`
      SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ProviderCredential'
        AND column_name IN ('providerAccountId', 'providerAccountExternalId')
    `;
    const numericIdentity = columns.find(
      (column) => column.columnName === "providerAccountId",
    );
    const externalIdentity = columns.find(
      (column) => column.columnName === "providerAccountExternalId",
    );
    if (
      numericIdentity?.dataType !== "bigint" ||
      numericIdentity.isNullable !== "YES" ||
      externalIdentity?.dataType !== "text" ||
      externalIdentity.isNullable !== "YES"
    ) {
      return false;
    }

    const constraints = await prisma.$queryRaw<
      Array<{ identityConstraintPresent: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ProviderCredential_provider_account_identity_check'
          AND conrelid = to_regclass('"ProviderCredential"')
          AND contype = 'c'
      ) AS "identityConstraintPresent"
    `;
    return constraints[0]?.identityConstraintPresent === true;
  } catch {
    return false;
  }
}

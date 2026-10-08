import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { legalPortfolioHistorySchema } from "@lcsp/contracts/legal-portfolio";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
@Injectable()
export class LegalPortfolioHistoryLoader {
  constructor(private readonly prisma: PrismaService) {}
  async load() {
    return this.prisma.$transaction(
      async (tx) => {
        const [portfolios, preparations, corpora] = await Promise.all([
          tx.legalPortfolioVersion.findMany({
            include: {
              _count: { select: { rules: true, engineeringRules: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.legalPreparationRun.findMany({
            include: { portfolio: true },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.legalCorpusVersion.findMany({
            where: { documents: { some: {} } },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        ]);
        return legalPortfolioHistorySchema.parse({
          portfolios: portfolios.map((row) => ({
            portfolioVersionId: row.id,
            version: row.version,
            legalCorpusVersionId: row.legalCorpusVersionId,
            lifecycleState: row.lifecycleState,
            activatedAt: row.activatedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            legalRuleCount: row._count.rules,
            engineeringRuleCount: row._count.engineeringRules,
          })),
          preparations: preparations.map((row) => ({
            preparationRunId: row.id,
            legalCorpusVersionId: row.legalCorpusVersionId,
            executionState: row.executionState,
            portfolioVersionId: row.portfolio?.id ?? null,
            createdAt: row.createdAt.toISOString(),
          })),
          corpora: corpora.map((row) => ({
            legalCorpusVersionId: row.id,
            version: row.version,
          })),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

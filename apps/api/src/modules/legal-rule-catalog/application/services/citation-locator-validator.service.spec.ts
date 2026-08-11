import { Test, type TestingModule } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { CitationLocatorValidatorService } from "./citation-locator-validator.service.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

describe("CitationLocatorValidatorService", () => {
  let service: CitationLocatorValidatorService;
  let prisma: jest.Mocked<PrismaService>;
  let mockFindApprovedCorpus: jest.Mock;
  let mockFindChunk: jest.Mock;

  beforeEach(async () => {
    mockFindApprovedCorpus = jest.fn().mockResolvedValue({ id: "v1" });
    mockFindChunk = jest.fn().mockResolvedValue({
      id: "chunk-1",
      legalCorpusVersionId: "v1",
      documentId: "doc1",
      locator: "art-1",
      legalStatus: "ACTIVE",
    });

    prisma = {
      legalCorpusVersion: {
        findFirst: mockFindApprovedCorpus,
      },
      legalDocumentChunk: {
        findFirst: mockFindChunk,
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CitationLocatorValidatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CitationLocatorValidatorService>(
      CitationLocatorValidatorService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("accepts a locator backed by an approved corpus and active chunk", async () => {
    await expect(
      service.validateAll([
        {
          legalCorpusVersionId: "v1",
          documentId: "doc1",
          locator: "art-1",
        },
      ]),
    ).resolves.toBeUndefined();

    expect(mockFindApprovedCorpus).toHaveBeenCalled();
    expect(mockFindChunk).toHaveBeenCalled();
  });
});

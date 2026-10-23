import { Test, type TestingModule } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { CitationLocatorValidatorService } from "./citation-locator-validator.service.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

describe("CitationLocatorValidatorService", () => {
  let service: CitationLocatorValidatorService;
  let prisma: jest.Mocked<PrismaService>;
  let mockFindApprovedLegalSource: ReturnType<
    typeof jest.fn<() => Promise<{ id: string } | null>>
  >;
  let mockFindChunk: ReturnType<
    typeof jest.fn<
      () => Promise<{
        id: string;
        legalSourceVersionId: string;
        documentId: string;
        locator: string;
        legalEffectStatus: string;
      } | null>
    >
  >;

  beforeEach(async () => {
    mockFindApprovedLegalSource = jest
      .fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValue({ id: "v1" });
    mockFindChunk = jest
      .fn<
        () => Promise<{
          id: string;
          legalSourceVersionId: string;
          documentId: string;
          locator: string;
          legalEffectStatus: string;
        } | null>
      >()
      .mockResolvedValue({
        id: "chunk-1",
        legalSourceVersionId: "v1",
        documentId: "doc1",
        locator: "art-1",
        legalEffectStatus: "EFFECTIVE",
      });

    prisma = {
      legalSourceVersion: {
        findFirst: mockFindApprovedLegalSource,
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

  it("accepts a locator backed by an approved legalSource and active chunk", async () => {
    await expect(
      service.validateAll([
        {
          legalSourceVersionId: "v1",
          documentId: "doc1",
          locator: "art-1",
        },
      ]),
    ).resolves.toBeUndefined();

    expect(mockFindApprovedLegalSource).toHaveBeenCalled();
    expect(mockFindChunk).toHaveBeenCalled();
  });
});

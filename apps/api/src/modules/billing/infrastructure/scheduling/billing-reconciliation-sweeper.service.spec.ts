import { describe, expect, it, jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import type { CommandBus } from "@nestjs/cqrs";
import { BillingReconciliationSweeperService } from "./billing-reconciliation-sweeper.service.js";
import { SweepExpiredInvocationLeasesCommand } from "../../application/commands/sweep-expired-invocation-leases/sweep-expired-invocation-leases.command.js";

describe("BillingReconciliationSweeperService", () => {
  it("starts periodic timer on onModuleInit and clears on onModuleDestroy", () => {
    const mockCommandBus = {
      execute: jest.fn<CommandBus["execute"]>().mockResolvedValue({
        sweptCount: 0,
        reconciliationCasesOpened: 0,
      } as never),
    } as unknown as CommandBus;

    const mockConfigService = {
      get: jest.fn<(key: string, defaultValue?: unknown) => unknown>((key, def) => def),
    } as unknown as ConfigService;

    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");

    const service = new BillingReconciliationSweeperService(
      mockCommandBus,
      mockConfigService,
    );

    service.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalled();

    service.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("dispatches SweepExpiredInvocationLeasesCommand when sweep is invoked", async () => {
    const mockCommandBus = {
      execute: jest.fn<CommandBus["execute"]>().mockResolvedValue({
        sweptCount: 2,
        reconciliationCasesOpened: 2,
      } as never),
    } as unknown as CommandBus;

    const mockConfigService = {
      get: jest.fn<(key: string, defaultValue?: unknown) => unknown>((key, def) => def),
    } as unknown as ConfigService;

    const service = new BillingReconciliationSweeperService(
      mockCommandBus,
      mockConfigService,
    );

    const result = await service.sweep();

    expect(result).toEqual({ sweptCount: 2, reconciliationCasesOpened: 2 });
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      expect.any(SweepExpiredInvocationLeasesCommand),
    );
  });
});

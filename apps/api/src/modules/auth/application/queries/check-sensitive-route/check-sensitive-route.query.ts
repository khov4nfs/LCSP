import { Query } from "@nestjs/cqrs";

import type { SensitiveRouteCheckDto } from "../../contracts/auth/sensitive-route.contract.js";

export class CheckSensitiveRouteQuery extends Query<SensitiveRouteCheckDto> {
  constructor(
    public readonly sessionId: string,
    public readonly method: string,
    public readonly route: string,
  ) {
    super();
  }
}

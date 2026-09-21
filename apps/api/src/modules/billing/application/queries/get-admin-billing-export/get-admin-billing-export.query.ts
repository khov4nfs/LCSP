import { Query } from "@nestjs/cqrs";
import type {
  BillingAdminExportQuery,
  BillingAdminExportReport,
} from "@lcsp/contracts/billing";

export class GetBillingAdminExportQuery extends Query<BillingAdminExportReport> {
  constructor(
    public readonly input: BillingAdminExportQuery,
    public readonly now?: Date,
  ) {
    super();
  }
}

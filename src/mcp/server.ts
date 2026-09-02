import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import type { SessionProps } from "../auth/session";
import { registerLookupTools } from "./tools/lookup";
import { registerHoursTools } from "./tools/hours";
import { registerCaseTools } from "./tools/cases";
import { registerBillingForecastTools } from "./tools/billing-forecast";
import { registerInvoiceTools } from "./tools/invoices";
import { registerProposalTools } from "./tools/proposals";
import { registerActivityTools } from "./tools/activities";
import { registerUserTools } from "./tools/users";
import { registerContactTools } from "./tools/contacts";
import { registerProductTools } from "./tools/products";
import { registerPhaseTools } from "./tools/phases";
import { registerResourceAllocationTools } from "./tools/resource-allocations";
import { registerFeeTools } from "./tools/fees";
import { registerTravelTools } from "./tools/travels";
import { registerOvertimeTools } from "./tools/overtimes";
import { registerHolidayTools } from "./tools/holidays";
import { registerRoleTools } from "./tools/roles";
import { registerPhaseMemberTools } from "./tools/phase-members";
import { registerRootPhaseTools } from "./tools/root-phases";
import { registerContactCommunicationTools } from "./tools/contact-communications";
import { registerFileTools } from "./tools/files";
import { registerAccountingTools } from "./tools/accounting";
import { registerCustomerSegmentTools } from "./tools/customer-segments";
import { registerProjectsWriteTools } from "./tools/projects-write";
import { registerQueryTools } from "./tools/query";
import { registerResources } from "./resources";
import { resolveCallerAuthz, registerAccessDeniedTool, AccessDeniedError, type CallerAuthz } from "../authz";

export class SeveraMcpAgent extends McpAgent<Env, Record<string, never>, SessionProps> {
  server = new McpServer({ name: "severa-mcp", version: "0.1.0" });

  async init(): Promise<void> {
    let authz: CallerAuthz;
    try {
      authz = await resolveCallerAuthz(this.env, this.props);
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        registerAccessDeniedTool(this.server, err.message);
        return;
      }
      throw err;
    }

    const enableWrites = this.env.ENABLE_WRITE_TOOLS === "true";
    const allow = (key: string) => !authz.blockedToolKeys.has(key);

    if (allow("lookup")) registerLookupTools(this.server, this.env, this.props);
    if (allow("cases")) registerCaseTools(this.server, this.env, this.props);
    if (allow("billing-forecast")) registerBillingForecastTools(this.server, this.env);
    if (allow("hours")) registerHoursTools(this.server, this.env, this.props, { enableWrites, authz });
    if (allow("invoices")) registerInvoiceTools(this.server, this.env);
    if (allow("proposals")) registerProposalTools(this.server, this.env);
    if (allow("activities")) registerActivityTools(this.server, this.env, this.props, authz);
    if (allow("users")) registerUserTools(this.server, this.env);
    if (allow("contacts")) registerContactTools(this.server, this.env);
    if (allow("products")) registerProductTools(this.server, this.env);
    if (allow("phases")) registerPhaseTools(this.server, this.env);
    if (allow("resource-allocations")) registerResourceAllocationTools(this.server, this.env, authz);
    if (allow("fees")) registerFeeTools(this.server, this.env);
    if (allow("travels")) registerTravelTools(this.server, this.env);
    if (allow("overtimes")) registerOvertimeTools(this.server, this.env);
    if (allow("holidays")) registerHolidayTools(this.server, this.env);
    if (allow("roles")) registerRoleTools(this.server, this.env);
    if (allow("phase-members")) registerPhaseMemberTools(this.server, this.env, authz);
    if (allow("root-phases")) registerRootPhaseTools(this.server, this.env);
    if (allow("contact-communications")) registerContactCommunicationTools(this.server, this.env);
    if (allow("files")) registerFileTools(this.server, this.env);
    if (allow("accounting")) registerAccountingTools(this.server, this.env);
    if (allow("customer-segments")) registerCustomerSegmentTools(this.server, this.env);
    if (enableWrites && allow("projects-write")) registerProjectsWriteTools(this.server, this.env);
    if (authz.canUseQuery) registerQueryTools(this.server, this.env);
    registerResources(this.server, this.env, this.props);
  }
}

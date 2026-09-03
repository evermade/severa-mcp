// MCP-protocol-level sanity: the full set of tools advertised to clients
// matches the expected registry. This catches regressions where:
// - a tool gets removed but its name is still referenced elsewhere
// - a new tool ships without a description
// - a tool is only registered in server.ts but not local.ts (or vice versa)
import { describe, it, expect } from "vitest";
import { listTools } from "../src/test/harness";
import { registerLookupTools } from "../src/mcp/tools/lookup";
import { registerCaseTools } from "../src/mcp/tools/cases";
import { registerBillingForecastTools } from "../src/mcp/tools/billing-forecast";
import { registerHoursTools } from "../src/mcp/tools/hours";
import { registerInvoiceTools } from "../src/mcp/tools/invoices";
import { registerProposalTools } from "../src/mcp/tools/proposals";
import { registerActivityTools } from "../src/mcp/tools/activities";
import { registerUserTools } from "../src/mcp/tools/users";
import { registerContactTools } from "../src/mcp/tools/contacts";
import { registerProductTools } from "../src/mcp/tools/products";
import { registerPhaseTools } from "../src/mcp/tools/phases";
import { registerResourceAllocationTools } from "../src/mcp/tools/resource-allocations";
import { registerFeeTools } from "../src/mcp/tools/fees";
import { registerTravelTools } from "../src/mcp/tools/travels";
import { registerOvertimeTools } from "../src/mcp/tools/overtimes";
import { registerHolidayTools } from "../src/mcp/tools/holidays";
import { registerRoleTools } from "../src/mcp/tools/roles";
import { registerPhaseMemberTools } from "../src/mcp/tools/phase-members";
import { registerRootPhaseTools } from "../src/mcp/tools/root-phases";
import { registerContactCommunicationTools } from "../src/mcp/tools/contact-communications";
import { registerFileTools } from "../src/mcp/tools/files";
import { registerAccountingTools } from "../src/mcp/tools/accounting";
import { registerCustomerSegmentTools } from "../src/mcp/tools/customer-segments";
import { registerProjectsWriteTools } from "../src/mcp/tools/projects-write";
import { registerQueryTools } from "../src/mcp/tools/query";

const registerAll = [
  registerLookupTools,
  registerCaseTools,
  registerBillingForecastTools,
  (s: Parameters<typeof registerHoursTools>[0], e: Parameters<typeof registerHoursTools>[1], p: Parameters<typeof registerHoursTools>[2]) =>
    registerHoursTools(s, e, p, { enableWrites: false }),
  registerInvoiceTools,
  registerProposalTools,
  registerActivityTools,
  registerUserTools,
  registerContactTools,
  registerProductTools,
  registerPhaseTools,
  registerResourceAllocationTools,
  registerFeeTools,
  registerTravelTools,
  registerOvertimeTools,
  registerHolidayTools,
  registerRoleTools,
  registerPhaseMemberTools,
  registerRootPhaseTools,
  registerContactCommunicationTools,
  registerFileTools,
  registerAccountingTools,
  registerCustomerSegmentTools,
  registerQueryTools,
];

const EXPECTED_TOOLS = [
  "severa_cases_missing_billing_forecast",
  "severa_find_customer",
  "severa_find_project",
  "severa_find_user",
  "severa_get_billing_forecast",
  "severa_get_case",
  "severa_get_customer",
  "severa_get_my_hours",
  "severa_get_project",
  "severa_get_proposal_breakdown",
  "severa_get_unbilled_hours",
  "severa_list_accounts",
  "severa_list_activities",
  "severa_list_bank_accounts",
  "severa_list_contact_communications",
  "severa_list_contact_persons",
  "severa_list_customer_market_segments",
  "severa_list_customers",
  "severa_list_files",
  "severa_list_flat_rates",
  "severa_list_holidays",
  "severa_list_invoice_rows",
  "severa_list_invoices",
  "severa_list_kpi_formulas",
  "severa_list_overtimes",
  "severa_list_phase_members",
  "severa_list_phases",
  "severa_list_products",
  "severa_list_project_fees",
  "severa_list_project_recurring_fees",
  "severa_list_project_travel_expenses",
  "severa_list_projects",
  "severa_list_proposals",
  "severa_list_resource_allocations",
  "severa_list_role_allocations",
  "severa_list_roles",
  "severa_list_root_phases",
  "severa_list_sales_cases",
  "severa_list_time_entries",
  "severa_list_travel_reimbursements",
  "severa_list_users",
  "severa_list_work_hours",
  "severa_list_workdays",
  "severa_pipeline_summary",
  "severa_projects_missing_billing_forecast",
  "severa_query",
];

describe("MCP tool registry (read-only surface)", () => {
  it("advertises exactly the expected set of tools", async () => {
    const tools = await listTools(registerAll);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it("gives every tool a substantive description (>=40 chars)", async () => {
    const tools = await listTools(registerAll);
    for (const t of tools) {
      expect(t.description, `${t.name} missing description`).toBeTruthy();
      expect(
        t.description!.length,
        `${t.name} description too short (${t.description!.length} chars)`,
      ).toBeGreaterThanOrEqual(40);
    }
  });

  it("has no duplicate tool names across registrar modules", async () => {
    const tools = await listTools(registerAll);
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });
});

describe("MCP tool registry (writes enabled)", () => {
  it("adds all hours:write tools when ENABLE_WRITE_TOOLS=true", async () => {
    const withWrites = [
      registerLookupTools,
      registerCaseTools,
      registerBillingForecastTools,
      (s: Parameters<typeof registerHoursTools>[0], e: Parameters<typeof registerHoursTools>[1], p: Parameters<typeof registerHoursTools>[2]) =>
        registerHoursTools(s, e, p, { enableWrites: true }),
      registerInvoiceTools,
      registerProposalTools,
      registerActivityTools,
      registerUserTools,
      registerContactTools,
      registerProductTools,
      registerPhaseTools,
      registerResourceAllocationTools,
      registerFeeTools,
      registerTravelTools,
      registerOvertimeTools,
      registerHolidayTools,
      registerRoleTools,
      registerPhaseMemberTools,
      registerRootPhaseTools,
      registerContactCommunicationTools,
      registerFileTools,
      registerAccountingTools,
      registerCustomerSegmentTools,
      registerProjectsWriteTools,
      registerQueryTools,
    ];
    const tools = await listTools(withWrites);
    const names = tools.map((t) => t.name);
    expect(names).toContain("severa_log_hours");
    expect(names).toContain("severa_update_hours");
    expect(names).toContain("severa_delete_hours");
    expect(names).toContain("severa_close_workday");
    expect(names).toContain("severa_create_project");
    expect(names).toContain("severa_update_project");
  });

  it("does not register write tools when ENABLE_WRITE_TOOLS is off", async () => {
    const tools = await listTools(registerAll);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("severa_log_hours");
    expect(names).not.toContain("severa_update_hours");
    expect(names).not.toContain("severa_delete_hours");
    expect(names).not.toContain("severa_close_workday");
    expect(names).not.toContain("severa_create_project");
    expect(names).not.toContain("severa_update_project");
  });
});

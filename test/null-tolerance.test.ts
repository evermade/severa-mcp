// Regression guard: LLMs frequently send `null` for every optional field
// they're not using (rather than omitting the key). Every tool's
// inputSchema must tolerate this. If a new tool is added with plain
// `.optional()` instead of `.nullish()`, this test will fail for it.
import { describe, it, expect } from "vitest";
import { listTools, mockSeveraFetch, withMcpServer } from "../src/test/harness";
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

// Tools that take *required* arguments (not covered by "pass null for
// every optional" since their required args can't be null). Listed
// explicitly so the test stays strict — removing a tool from here after
// it changes required→optional should be intentional.
const REQUIRED_ARGS: Record<string, Record<string, unknown>> = {
  severa_get_case: { caseGuid: "00000000-0000-0000-0000-000000000001" },
  severa_get_project: { projectGuid: "00000000-0000-0000-0000-000000000001" },
  severa_get_customer: { customerGuid: "00000000-0000-0000-0000-000000000001" },
  severa_get_unbilled_hours: { projectGuid: "00000000-0000-0000-0000-000000000001" },
  severa_get_billing_forecast: { projectGuid: "00000000-0000-0000-0000-000000000001" },
  severa_find_customer: { text: "x" },
  severa_find_project: { text: "x" },
  severa_query: { path: "/v1/customers" },
  severa_list_files: {
    scope: "project",
    parentGuid: "00000000-0000-0000-0000-000000000001",
  },
  severa_list_accounts: { kind: "sales" },
  severa_get_proposal_breakdown: {
    proposalGuid: "00000000-0000-0000-0000-000000000001",
  },
};

describe("Every tool's optional fields accept null (LLM-friendliness)", () => {
  it("does not reject null on any optional arg", { timeout: 15_000 }, async () => {
    // Mock fetch to return an empty array for any endpoint, and succeed
    // the token exchange. We don't care about the response shape — only
    // that schema validation on input doesn't reject null.
    mockSeveraFetch({
      // Catch-all: every pathname ending gets an empty list
      routes: [
        { path: "/v1/", response: [] },
        ...[
          "/v1/customers",
          "/v1/projects",
          "/v1/salescases",
          "/v1/users",
          "/v1/contactpersons",
          "/v1/activities",
          "/v1/proposals",
          "/v1/products",
          "/v1/phases",
          "/v1/workhours",
          "/v1/timeentries",
          "/v1/workdays",
          "/v1/invoices",
          "/v1/invoicerows",
          "/v1/projectfees",
          "/v1/projecttravelexpenses",
          "/v1/travelreimbursements",
          "/v1/resourceallocations",
          "/v1/roleallocations",
          "/v1/overtimes",
          "/v1/holidays",
          "/v1/holidaysbytimeperiod",
          "/v1/roles",
          "/v1/phasemembers",
          "/v1/rootphaseswithhierarchy",
          "/v1/contactcommunications",
          "/v1/flatrates",
          "/v1/projectrecurringfeerules",
          "/v1/proposalworkrows",
          "/v1/proposalfeerows",
          "/v1/proposalsubtotals",
          "/v1/bankaccounts",
          "/v1/salesaccounts",
          "/v1/costaccounts",
          "/v1/kpiformulas",
          "/v1/customermarketsegments",
        ].map((path) => ({ path, response: [] as unknown[] })),
      ],
    });

    const tools = await listTools(registerAll);
    const handle = await withMcpServer(registerAll);
    try {
      for (const tool of tools) {
        // Pull the advertised input schema from the MCP list response
        const { tools: live } = await handle.client.listTools();
        const meta = live.find((t) => t.name === tool.name);
        const schema = meta?.inputSchema as
          | { properties?: Record<string, unknown>; required?: string[] }
          | undefined;
        if (!schema?.properties) continue;

        const required = new Set(schema.required ?? []);
        const baseArgs = REQUIRED_ARGS[tool.name] ?? {};
        const args: Record<string, unknown> = { ...baseArgs };
        for (const key of Object.keys(schema.properties)) {
          if (required.has(key)) continue;
          if (key in args) continue;
          args[key] = null;
        }

        // If a tool expected a required arg we haven't mapped, skip it
        // with a failure — flags missing test coverage
        for (const r of required) {
          if (!(r in args)) {
            throw new Error(
              `Tool ${tool.name} has required arg '${r}' not covered by REQUIRED_ARGS`,
            );
          }
        }

        const result = await handle.client.callTool({
          name: tool.name,
          arguments: args,
        });
        // We accept tool-level errors (e.g., "No X match those filters")
        // but NOT input-validation errors from Zod.
        if (result.isError) {
          const blocks = (result.content ?? []) as { type: string; text?: string }[];
          const text = blocks.map((b) => b.text ?? "").join("");
          expect(
            text,
            `Tool ${tool.name} rejected null args with an input-validation error:\n${text}`,
          ).not.toMatch(/Input validation error|Expected .* received "null"|invalid_type/);
        }
      }
    } finally {
      await handle.close();
    }
  });
});

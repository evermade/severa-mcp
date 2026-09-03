// Regression guard: claude.ai's MCP client silently drops values for optional
// fields whose JSON Schema uses `$ref` to a shared definition that unions
// with `null` (observed on `severa_list_projects.salesStatusChangedSince`:
// the date arrived as the literal string "null" and the validator dropped
// the field instead of erroring).
//
// Root cause: Zod's JSON Schema generator deduplicates shared const-bound
// schemas (e.g. `const isoDate = z.string().regex(...)`) into
// `#/definitions/...` refs. When the same schema is then `.nullish()`, the
// output becomes `{ anyOf: [{ $ref: ... }, { type: "null" }] }` — which
// claude.ai's transport appears to mishandle.
//
// Fix: export factory functions (`const isoDate = () => z.string()...`) so
// every use-site produces a fresh Zod schema and the generator inlines the
// pattern directly on the property. This test enforces that property.
import { describe, it, expect } from "vitest";
import { listTools, withMcpServer } from "../src/test/harness";
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

function findRefs(value: unknown, path: string[] = []): string[] {
  if (value == null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findRefs(v, [...path, String(i)]));
  }
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "$ref") hits.push([...path, k].join("."));
    hits.push(...findRefs(v, [...path, k]));
  }
  return hits;
}

describe("Tool input schemas do not use $ref (claude.ai transport compat)", () => {
  it("no $ref appears in any advertised inputSchema", async () => {
    const handle = await withMcpServer(registerAll);
    try {
      const { tools } = await handle.client.listTools();
      const offenders: { tool: string; paths: string[] }[] = [];
      for (const t of tools) {
        const refs = findRefs(t.inputSchema);
        if (refs.length) offenders.push({ tool: t.name, paths: refs });
      }
      expect(
        offenders,
        `Tools with $ref in inputSchema (claude.ai strips values on these):\n${offenders
          .map((o) => `  ${o.tool}: ${o.paths.slice(0, 3).join(", ")}${o.paths.length > 3 ? ` (+${o.paths.length - 3} more)` : ""}`)
          .join("\n")}`,
      ).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("ISO-date fields advertise their pattern inline (not behind $ref)", async () => {
    // Spot-check a few tools that have date filters — their date fields
    // must carry a YYYY-MM-DD pattern directly on the property, so
    // claude.ai's transport sees a fully-specified primitive.
    const tools = await listTools(registerAll);
    // salesStatusChangedSince only lives on /v1/projects (not /v1/salescases).
    // This was the exact field whose value was getting stripped by claude.ai
    // before the shared-schema-dedup fix.
    const dateFields: Record<string, string[]> = {
      severa_list_projects: ["salesStatusChangedSince", "changedSince", "closedFrom"],
      severa_list_sales_cases: ["closedFrom", "closedTo", "invoiceableDate"],
      severa_list_invoices: ["startDate", "endDate", "changedSince"],
      severa_list_activities: ["changedSince"],
    };

    const handle = await withMcpServer(registerAll);
    try {
      const { tools: live } = await handle.client.listTools();
      for (const [toolName, fields] of Object.entries(dateFields)) {
        if (!tools.find((t) => t.name === toolName)) continue;
        const meta = live.find((t) => t.name === toolName);
        const props = (meta?.inputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {};
        for (const field of fields) {
          const schema = props[field];
          expect(schema, `${toolName}.${field} missing from inputSchema`).toBeDefined();
          const text = JSON.stringify(schema);
          expect(
            text,
            `${toolName}.${field} schema must contain YYYY-MM-DD pattern inline:\n${text}`,
          ).toMatch(/\\\\d\{4\}-\\\\d\{2\}-\\\\d\{2\}/);
          expect(text, `${toolName}.${field} must not use $ref`).not.toContain("$ref");
        }
      }
    } finally {
      await handle.close();
    }
  });
});

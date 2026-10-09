// Shared server setup for both transports (worker: mcp/server.ts, stdio:
// local.ts), so registration and its failure handling can't drift apart.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import {
  resolveCallerAuthz,
  registerAccessDeniedTool,
  AccessDeniedError,
  type CallerAuthz,
} from "../authz";
import { log, errorMessage } from "../log";

// Used when the caller's role can't be resolved at connect time (Severa
// 429/5xx, token failure, KV hiccup). Registration is only tool-list
// tailoring — every handler re-resolves authz itself (requireCategoryAccess /
// resolveCallerAuthz) and fails closed — so advertising everything here is
// safe, whereas throwing would fail the whole MCP connection. That used to
// surface on claude.ai as "returned an error when connecting", and left the
// Durable Object with zero tools until it was evicted (agents' McpAgent marks
// init as run before calling it, so a throwing init is never retried).
const REGISTRATION_FALLBACK: CallerAuthz = {
  isFullAccess: false,
  rowScope: "all",
  selfGuid: null,
  blockedToolKeys: new Set(),
  canUseQuery: true,
};

export async function registerSeveraServer(
  server: McpServer,
  env: Env,
  props: SessionProps,
): Promise<void> {
  const started = Date.now();
  instrumentServer(server, props);

  let authz: CallerAuthz;
  let fallback = false;
  try {
    authz = await resolveCallerAuthz(env, props);
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      registerAccessDeniedTool(server, err.message);
      log("mcp.init", {
        user: props.email,
        outcome: "denied",
        reason: err.message,
        durationMs: Date.now() - started,
      });
      return;
    }
    log(
      "mcp.init",
      {
        user: props.email,
        outcome: "fallback",
        error: errorMessage(err),
        severaStatus: (err as { status?: number }).status,
      },
      "warn",
    );
    authz = REGISTRATION_FALLBACK;
    fallback = true;
  }

  const enableWrites = env.ENABLE_WRITE_TOOLS === "true";
  const allow = (key: string) => !authz.blockedToolKeys.has(key);

  if (allow("lookup")) registerLookupTools(server, env, props);
  if (allow("cases")) registerCaseTools(server, env, props);
  if (allow("billing-forecast")) registerBillingForecastTools(server, env, props);
  if (allow("hours")) registerHoursTools(server, env, props, { enableWrites });
  if (allow("invoices")) registerInvoiceTools(server, env, props);
  if (allow("proposals")) registerProposalTools(server, env, props);
  if (allow("activities")) registerActivityTools(server, env, props);
  if (allow("users")) registerUserTools(server, env, props);
  if (allow("contacts")) registerContactTools(server, env, props);
  if (allow("products")) registerProductTools(server, env, props);
  if (allow("phases")) registerPhaseTools(server, env, props);
  if (allow("resource-allocations")) registerResourceAllocationTools(server, env, props);
  if (allow("fees")) registerFeeTools(server, env, props);
  if (allow("travels")) registerTravelTools(server, env, props);
  if (allow("overtimes")) registerOvertimeTools(server, env, props);
  if (allow("holidays")) registerHolidayTools(server, env, props);
  if (allow("roles")) registerRoleTools(server, env, props);
  if (allow("phase-members")) registerPhaseMemberTools(server, env, props);
  if (allow("root-phases")) registerRootPhaseTools(server, env, props);
  if (allow("contact-communications")) registerContactCommunicationTools(server, env, props);
  if (allow("files")) registerFileTools(server, env, props);
  if (allow("accounting")) registerAccountingTools(server, env, props);
  if (allow("customer-segments")) registerCustomerSegmentTools(server, env, props);
  if (enableWrites && allow("projects-write")) registerProjectsWriteTools(server, env, props);
  if (authz.canUseQuery) registerQueryTools(server, env, props);
  registerResources(server, env, props);

  if (!fallback) {
    log("mcp.init", {
      user: props.email,
      outcome: "ok",
      tier: authz.isFullAccess ? "full" : authz.rowScope === "self" ? "self" : "business",
      blockedTools: [...authz.blockedToolKeys],
      durationMs: Date.now() - started,
    });
  }
}

// Wraps every tool handler registered afterwards with a `tool.call` log line
// (duration + outcome), so failures are visible per tool and per user
// without touching each tool module.
export function instrumentServer(server: McpServer, props: SessionProps): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (
    name: string,
    config: unknown,
    cb: (...args: unknown[]) => unknown,
  ) =>
    original(name, config, async (...args: unknown[]) => {
      const started = Date.now();
      try {
        const result = await cb(...args);
        const isError = (result as { isError?: boolean } | undefined)?.isError === true;
        log(
          "tool.call",
          { tool: name, user: props.email, outcome: isError ? "error" : "ok", durationMs: Date.now() - started },
          isError ? "warn" : "info",
        );
        return result;
      } catch (err) {
        const denied = err instanceof AccessDeniedError;
        log(
          "tool.call",
          {
            tool: name,
            user: props.email,
            outcome: denied ? "denied" : "error",
            error: errorMessage(err),
            severaStatus: (err as { status?: number }).status,
            durationMs: Date.now() - started,
          },
          denied ? "warn" : "error",
        );
        throw err;
      }
    });
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch } from "../../severa/client";
import type { ProjectOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { requireCategoryAccess } from "../../authz";

// Create / update tools for projects. Sales cases are projects with a
// salesStatus set — the same POST /v1/projects and PATCH /v1/projects/{guid}
// endpoints handle both, so one tool per verb covers both surfaces.
//
// Requires `projects:write` scope (not granted by default). Registered only
// when `ENABLE_WRITE_TOOLS=true`.

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = () => z.string().uuid();

export function registerProjectsWriteTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_create_project",
    {
      description: [
        "Create a new project via `POST /v1/projects`. Also used to create a sales case — pass `salesStatusGuid` to stage it as a sales case, omit to create a regular project.",
        "",
        "Required:",
        "- `name`",
        "- `customerGuid` — resolve via `severa_find_customer`",
        "- `projectOwnerGuid` — resolve via `severa_find_user`",
        "",
        "Common optional fields:",
        "- `businessUnitGuid`, `salesPersonGuid`, `customerContactGuid`",
        "- `description`, `internalName`",
        "- `startDate` / `deadline` — YYYY-MM-DD",
        "- `isInternal`",
        "- `salesStatusGuid` / `projectStatusGuid` — discover via `severa_query({ path: '/v1/salesstatustypes' | '/v1/projectstatustypes' })`",
        "- `probability` — 0–100 (sales cases)",
        "- `expectedOrderDate`",
        "- `expectedValueAmount` + `expectedValueCurrencyCode` — EUR if omitted",
        "- `currencyGuid` — resolve via reference data if the project currency differs from the business-unit default",
        "",
        "Returns the created project's GUID and name.",
      ].join("\n"),
      inputSchema: {
        name: z.string().min(1),
        customerGuid: uuid(),
        projectOwnerGuid: uuid(),
        businessUnitGuid: uuid().nullish(),
        salesPersonGuid: uuid().nullish(),
        customerContactGuid: uuid().nullish(),
        description: z.string().nullish(),
        internalName: z.string().nullish(),
        startDate: isoDate().nullish(),
        deadline: isoDate().nullish(),
        isInternal: z.boolean().nullish(),
        salesStatusGuid: uuid().nullish(),
        projectStatusGuid: uuid().nullish(),
        probability: z.number().int().min(0).max(100).nullish(),
        expectedOrderDate: isoDate().nullish(),
        expectedValueAmount: z.number().nullish(),
        expectedValueCurrencyCode: z.string().min(3).max(3).nullish(),
        currencyGuid: uuid().nullish(),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Create project / case" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "projects-write");
      const body: Record<string, unknown> = {
        name: args.name,
        customer: { guid: args.customerGuid },
        projectOwner: { guid: args.projectOwnerGuid },
        ...(args.businessUnitGuid ? { businessUnit: { guid: args.businessUnitGuid } } : {}),
        ...(args.salesPersonGuid ? { salesPerson: { guid: args.salesPersonGuid } } : {}),
        ...(args.customerContactGuid ? { customerContact: { guid: args.customerContactGuid } } : {}),
        ...(args.description != null ? { description: args.description } : {}),
        ...(args.internalName != null ? { internalName: args.internalName } : {}),
        ...(args.startDate ? { startDate: args.startDate } : {}),
        ...(args.deadline ? { deadline: args.deadline } : {}),
        ...(args.isInternal != null ? { isInternal: args.isInternal } : {}),
        ...(args.salesStatusGuid ? { salesStatus: { guid: args.salesStatusGuid } } : {}),
        ...(args.projectStatusGuid ? { projectStatus: { guid: args.projectStatusGuid } } : {}),
        ...(args.probability != null ? { probability: args.probability } : {}),
        ...(args.expectedOrderDate ? { expectedOrderDate: args.expectedOrderDate } : {}),
        ...(args.expectedValueAmount != null
          ? {
              expectedValue: {
                amount: args.expectedValueAmount,
                currencyCode: args.expectedValueCurrencyCode ?? "EUR",
              },
            }
          : {}),
        ...(args.currencyGuid ? { currency: { guid: args.currencyGuid } } : {}),
      };

      const created = await severaFetch<ProjectOutputModel>(env, "/v1/projects", {
        method: "POST",
        body,
      });
      return toText(
        `Created ${args.salesStatusGuid ? "sales case" : "project"} **${created.name}** — \`${created.guid}\`.`,
      );
    },
  );

  server.registerTool(
    "severa_update_project",
    {
      description: [
        "Update fields on an existing project or sales case via JSON Patch to `/v1/projects/{guid}`. Pass only the fields you want to change — an omitted field is left untouched; `null` is treated the same as omission.",
        "",
        "Common moves:",
        "- Advance a sales case's stage: `salesStatusGuid` (optionally with `probability`)",
        "- Close / reopen a project: `isClosed`",
        "- Update deadline or expected order date",
        "- Reassign: `projectOwnerGuid` / `salesPersonGuid`",
        "- Mark internal: `isInternal`",
      ].join("\n"),
      inputSchema: {
        projectGuid: uuid(),
        name: z.string().min(1).nullish(),
        description: z.string().nullish(),
        projectOwnerGuid: uuid().nullish(),
        salesPersonGuid: uuid().nullish(),
        businessUnitGuid: uuid().nullish(),
        startDate: isoDate().nullish(),
        deadline: isoDate().nullish(),
        isClosed: z.boolean().nullish(),
        isInternal: z.boolean().nullish(),
        salesStatusGuid: uuid().nullish(),
        projectStatusGuid: uuid().nullish(),
        probability: z.number().int().min(0).max(100).nullish(),
        expectedOrderDate: isoDate().nullish(),
        expectedValueAmount: z.number().nullish(),
        expectedValueCurrencyCode: z.string().min(3).max(3).nullish(),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Update project / case" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "projects-write");
      const ops: Array<{ op: "replace"; path: string; value: unknown }> = [];
      if (args.name != null) ops.push({ op: "replace", path: "/name", value: args.name });
      if (args.description != null)
        ops.push({ op: "replace", path: "/description", value: args.description });
      if (args.projectOwnerGuid != null)
        ops.push({ op: "replace", path: "/projectOwner/guid", value: args.projectOwnerGuid });
      if (args.salesPersonGuid != null)
        ops.push({ op: "replace", path: "/salesPerson/guid", value: args.salesPersonGuid });
      if (args.businessUnitGuid != null)
        ops.push({ op: "replace", path: "/businessUnit/guid", value: args.businessUnitGuid });
      if (args.startDate != null)
        ops.push({ op: "replace", path: "/startDate", value: args.startDate });
      if (args.deadline != null) ops.push({ op: "replace", path: "/deadline", value: args.deadline });
      if (args.isClosed != null) ops.push({ op: "replace", path: "/isClosed", value: args.isClosed });
      if (args.isInternal != null)
        ops.push({ op: "replace", path: "/isInternal", value: args.isInternal });
      if (args.salesStatusGuid != null)
        ops.push({ op: "replace", path: "/salesStatus/guid", value: args.salesStatusGuid });
      if (args.projectStatusGuid != null)
        ops.push({ op: "replace", path: "/projectStatus/guid", value: args.projectStatusGuid });
      if (args.probability != null)
        ops.push({ op: "replace", path: "/probability", value: args.probability });
      if (args.expectedOrderDate != null)
        ops.push({ op: "replace", path: "/expectedOrderDate", value: args.expectedOrderDate });
      if (args.expectedValueAmount != null) {
        ops.push({
          op: "replace",
          path: "/expectedValue",
          value: {
            amount: args.expectedValueAmount,
            currencyCode: args.expectedValueCurrencyCode ?? "EUR",
          },
        });
      }

      if (!ops.length) return toText("No changes provided — specify at least one field to update.");

      await severaFetch<unknown>(env, `/v1/projects/${args.projectGuid}`, {
        method: "PATCH",
        body: ops,
      });
      return toText(
        `Updated ${ops.length} field(s) on project \`${args.projectGuid}\`: ${ops.map((o) => o.path.slice(1)).join(", ")}.`,
      );
    },
  );
}

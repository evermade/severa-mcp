import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import type { FileMetadataModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";
import { requireCategoryAccess } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const SCOPE_TO_PATH = {
  project: (guid: string) => `/v1/projects/${guid}/files`,
  customer: (guid: string) => `/v1/customers/${guid}/files`,
  invoice: (guid: string) => `/v1/invoices/${guid}/files`,
  travel_expense: (guid: string) => `/v1/projecttravelexpenses/${guid}/files`,
} as const;

export function registerFileTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_files",
    {
      description: [
        "List file *attachments* on a Severa entity — metadata only (name, size, type, uploader, dates, `isInternal` flag).",
        "",
        "IMPORTANT: this tool does NOT download file contents. It tells you what files exist. For now, if you need the actual file, users should open it in Severa directly — MCP-level content download is intentionally deferred while we work out permission parity with the Severa UI (the service-account token we use has broader access than any individual user).",
        "",
        "Args:",
        "- `scope` — one of `project`, `customer`, `invoice`, `travel_expense`",
        "- `parentGuid` — GUID of the parent record",
        "- `includeInternal` — default true; set false to hide files flagged `isInternal: true` (staff-only attachments)",
        "- `contentTypeContains` — filter by mime substring (e.g. `pdf`, `image/`)",
        "- `limit` default 100, max 500",
        "",
        "Returns name, size (bytes), contentType, isInternal, uploader, upload date, GUID.",
      ].join("\n"),
      inputSchema: {
        scope: z.enum(["project", "customer", "invoice", "travel_expense"]),
        parentGuid: z.string().uuid(),
        includeInternal: z.boolean().nullish(),
        contentTypeContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List file attachments" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "files");
      const limit = args.limit ?? 100;
      const includeInternal = args.includeInternal ?? true;
      const path = SCOPE_TO_PATH[args.scope](args.parentGuid);

      const rows = await severaPaginate<FileMetadataModel>(env, path, {
        query: { rowCount: Math.min(1000, Math.max(limit, 100)) },
      });

      const hits = rows
        .filter((f) => {
          if (!includeInternal && f.isInternal) return false;
          if (
            args.contentTypeContains &&
            !(f.contentType ?? "").toLowerCase().includes(args.contentTypeContains.toLowerCase())
          ) {
            return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) {
        return toText(
          `No files attached to ${args.scope} \`${args.parentGuid}\`${!includeInternal ? " (matching, excluding internal)" : ""}.`,
        );
      }

      const totalBytes = hits.reduce((s, f) => s + (f.size ?? 0), 0);
      return toText(
        `${hits.length} file(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} on ${args.scope} \`${args.parentGuid}\` — ${formatBytes(totalBytes)} total:\n${hits.map(renderFileRow).join("\n")}`,
      );
    },
  );
}

function renderFileRow(f: FileMetadataModel): string {
  const who =
    f.createdBy?.name ||
    [f.createdBy?.firstName, f.createdBy?.lastName].filter(Boolean).join(" ") ||
    undefined;
  const parts = [
    `**${f.name ?? "(no name)"}**`,
    f.contentType,
    f.size != null ? formatBytes(f.size) : undefined,
    f.isInternal ? "🔒 internal" : undefined,
    f.createdDateTime?.slice(0, 10),
    who,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${f.guid}\``;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

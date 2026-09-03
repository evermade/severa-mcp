import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { ContactCommunicationModel } from "../../severa/types";
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

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerContactCommunicationTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_contact_communications",
    {
      description: [
        "List contact *communication channels* (email addresses, phone numbers, etc.) from `/v1/contactcommunications`. Answers 'what's the email / phone for contact X?'.",
        "",
        "Note: this is NOT a log of sent emails or calls — it's the communication *channels* stored on contact-person records.",
        "",
        "Server-side filters:",
        "- `active`",
        "- `textToSearch` — substring match on value (email/phone)",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `contactGuid` — scope to one contact person",
        "- `typeNameContains` — e.g. 'email', 'phone', 'mobile'",
        "- `valueContains` — substring on the email/phone value",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        active: z.boolean().nullish(),
        textToSearch: z.string().min(1).nullish(),
        changedSince: isoDate().nullish(),
        contactGuid: z.string().uuid().nullish(),
        typeNameContains: z.string().min(1).nullish(),
        valueContains: z.string().min(1).nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List contact communications" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "contact-communications");
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ContactCommunicationModel>(
        env,
        "/v1/contactcommunications",
        {
          query: {
            ...(args.active != null ? { active: args.active } : {}),
            ...(args.textToSearch ? { textToSearch: args.textToSearch } : {}),
            ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
            rowCount: Math.min(1000, Math.max(limit, 100)),
          },
        },
      );

      const hits = rows
        .filter((c) => {
          if (args.contactGuid && c.contact?.guid !== args.contactGuid) return false;
          if (args.typeNameContains && !matches(c.communicationType?.name, args.typeNameContains)) {
            return false;
          }
          if (args.valueContains && !matches(c.value, args.valueContains)) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No contact communications match those filters.");
      return toText(
        `${hits.length} channel(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderRow).join("\n")}`,
      );
    },
  );
}

function renderRow(c: ContactCommunicationModel): string {
  const parts = [
    `**${c.communicationType?.name ?? "(no type)"}**`,
    c.value ?? "(empty)",
    c.isForbiddenToUse ? "🚫 do-not-contact" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — contact \`${c.contact?.guid ?? "?"}\` — \`${c.guid}\``;
}

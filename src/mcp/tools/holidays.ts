import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate, severaFetch } from "../../severa/client";
import type { HolidayOutputModel } from "../../severa/types";
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

export function registerHolidayTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_holidays",
    {
      description: [
        "List public / recurring holidays defined in Severa.",
        "",
        "Two endpoints — auto-selected by which args you provide:",
        "- With `startDate` / `endDate` → hits `/v1/holidaysbytimeperiod` (expands recurring entries into concrete dates in the window).",
        "- With `year` (or neither) → hits `/v1/holidays` (raw definitions).",
        "",
        "Args:",
        "- `startDate` / `endDate` — YYYY-MM-DD (mutually inclusive; both or neither)",
        "- `year` — integer, only applies when no date range is given",
        "- `countryGuid` — resolve via `severa_query({ path: '/v1/countries' })`",
        "",
        "Returns holiday name, date, public/private flag.",
      ].join("\n"),
      inputSchema: {
        startDate: isoDate().nullish(),
        endDate: isoDate().nullish(),
        year: z.number().int().min(1900).max(2100).nullish(),
        countryGuid: z.string().uuid().nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List holidays" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "holidays");
      const usePeriod = Boolean(args.startDate || args.endDate);
      if (usePeriod && !(args.startDate && args.endDate)) {
        return toText("Provide both startDate and endDate, or neither.");
      }

      let rows: HolidayOutputModel[];
      if (usePeriod) {
        rows = await severaFetch<HolidayOutputModel[]>(env, "/v1/holidaysbytimeperiod", {
          query: {
            startDate: `${args.startDate}T00:00:00Z`,
            endDate: `${args.endDate}T23:59:59Z`,
            ...(args.countryGuid ? { countryGuid: args.countryGuid } : {}),
          },
        });
      } else {
        rows = await severaPaginate<HolidayOutputModel>(env, "/v1/holidays", {
          query: {
            ...(args.year != null ? { year: args.year } : {}),
            ...(args.countryGuid ? { countryGuid: args.countryGuid } : {}),
          },
        });
      }

      if (!rows.length) return toText("No holidays match those filters.");
      // Sort by date (undated last)
      rows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      return toText(
        `${rows.length} holiday(s)${usePeriod ? ` between ${args.startDate} and ${args.endDate}` : args.year ? ` in ${args.year}` : ""}:\n${rows.map(renderHolidayRow).join("\n")}`,
      );
    },
  );
}

function renderHolidayRow(h: HolidayOutputModel): string {
  const parts = [
    `**${h.name ?? "(no name)"}**`,
    h.date?.slice(0, 10),
    h.isPublicHoliday ? "public" : undefined,
    h.isRecurringYearly ? "recurring" : undefined,
    h.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${h.guid}\``;
}

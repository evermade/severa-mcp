import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { helsinkiToday, addDays } from "../../severa/dates";
import type {
  ProjectForecastOutputModel,
  ProjectOutputModel,
} from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { formatMoney, toText } from "../format";
import { requireCategoryAccess } from "../../authz";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerBillingForecastTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_get_billing_forecast",
    {
      description:
        "Return project-forecast rows (including billingForecast) for a project within a horizon. Default horizon: today → +180 days.",
      inputSchema: {
        projectGuid: z.string().uuid(),
        horizonDays: z.number().int().min(1).max(730).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Get billing forecast" },
    },
    async ({ projectGuid, horizonDays }) => {
      await requireCategoryAccess(env, props, "billing-forecast");
      const rows = await loadForecast(env, projectGuid, horizonDays ?? 180);
      if (!rows.length) return toText("No forecast rows in range.");
      const lines = rows.map(
        (r) =>
          `- ${monthLabel(r.year, r.month)}: billing ${formatMoney(r.billingForecast)}` +
          (r.revenueForecast ? `, revenue ${formatMoney(r.revenueForecast)}` : "") +
          (r.billingForecastNotes ? ` — ${r.billingForecastNotes}` : ""),
      );
      const sum = rows.reduce((s, r) => s + (r.billingForecast?.amount ?? 0), 0);
      const currency = rows.find((r) => r.billingForecast?.currencyCode)?.billingForecast
        ?.currencyCode ?? "EUR";
      return toText(
        `Billing forecast total: ${sum.toLocaleString("sv-FI")} ${currency} over ${rows.length} month(s)\n${lines.join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_projects_missing_billing_forecast",
    {
      description:
        "Find active non-internal projects that have no billing-forecast rows in the upcoming horizon window.",
      inputSchema: {
        horizonDays: z.number().int().min(30).max(730).nullish(),
        limit: z.number().int().min(1).max(200).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Projects missing forecast" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "billing-forecast");
      const horizonDays = args.horizonDays ?? 90;
      const limit = args.limit ?? 100;
      const projects = await severaPaginate<ProjectOutputModel>(env, "/v1/projects", {
        query: { isClosed: false, internal: false, rowCount: limit },
      });
      const misses: ProjectOutputModel[] = [];
      for (const p of projects) {
        const rows = await loadForecast(env, p.guid, horizonDays).catch(() => []);
        const hasBilling = rows.some((r) => (r.billingForecast?.amount ?? 0) > 0);
        if (!hasBilling) misses.push(p);
      }
      if (!misses.length)
        return toText(
          `All ${projects.length} active non-internal projects have billing forecast within ${horizonDays} days.`,
        );
      const lines = misses.map(
        (p) => `- ${p.name}${p.customer ? ` — ${p.customer.name}` : ""} — \`${p.guid}\``,
      );
      return toText(
        `${misses.length} of ${projects.length} active projects lack billing forecast in the next ${horizonDays} days:\n${lines.join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_cases_missing_billing_forecast",
    {
      description:
        "Find open sales cases (probability ≥ `minProbability`) whose billing forecast falls short of `expectedValue × probability` in the horizon window.",
      inputSchema: {
        minProbability: z.number().min(0).max(100).nullish(),
        horizonDays: z.number().int().min(30).max(730).nullish(),
        limit: z.number().int().min(1).max(200).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Cases missing forecast" },
    },
    async (args) => {
      await requireCategoryAccess(env, props, "billing-forecast");
      const minProbability = args.minProbability ?? 75;
      const horizonDays = args.horizonDays ?? 180;
      const limit = args.limit ?? 100;
      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: { isClosed: false, rowCount: limit },
      });
      const candidates = cases.filter((c) => (c.probability ?? 0) >= minProbability);
      if (!candidates.length)
        return toText(
          `No open cases at probability ≥ ${minProbability}%.`,
        );

      const flagged: { c: ProjectOutputModel; forecast: number; threshold: number; currency: string }[] = [];
      for (const c of candidates) {
        const rows = await loadForecast(env, c.guid, horizonDays).catch(() => []);
        const forecast = rows.reduce((s, r) => s + (r.billingForecast?.amount ?? 0), 0);
        const threshold = ((c.expectedValue?.amount ?? 0) * (c.probability ?? 0)) / 100;
        const currency = c.expectedValue?.currencyCode ?? "EUR";
        if (forecast < threshold) flagged.push({ c, forecast, threshold, currency });
      }
      if (!flagged.length)
        return toText(
          `All ${candidates.length} open cases at probability ≥ ${minProbability}% have matching billing forecast.`,
        );
      const lines = flagged.map(
        ({ c, forecast, threshold, currency }) =>
          `- **${c.name}**${c.customer ? ` — ${c.customer.name}` : ""} — ${c.probability ?? 0}% — expected ${formatMoney(c.expectedValue)} — forecast ${forecast.toLocaleString("sv-FI")} ${currency} < threshold ${threshold.toLocaleString("sv-FI")} ${currency} — \`${c.guid}\``,
      );
      return toText(
        `${flagged.length} of ${candidates.length} high-probability cases need forecast attention:\n${lines.join("\n")}`,
      );
    },
  );
}

async function loadForecast(
  env: Env,
  projectGuid: string,
  horizonDays: number,
): Promise<ProjectForecastOutputModel[]> {
  const from = helsinkiToday();
  const to = addDays(from, horizonDays);
  return severaFetch<ProjectForecastOutputModel[]>(
    env,
    `/v1/projects/${projectGuid}/projectforecasts`,
    {
      query: { startDate: `${from}T00:00:00Z`, endDate: `${to}T23:59:59Z` },
    },
  );
}

function monthLabel(year: number | undefined, month: number | undefined): string {
  if (!year || !month) return "(no date)";
  return `${year}-${String(month).padStart(2, "0")}`;
}

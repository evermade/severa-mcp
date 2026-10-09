// Structured logging. Each line is a single JSON object so Workers Logs
// (wrangler.toml `[observability]`) indexes every field — query e.g.
// `event = "tool.call" AND outcome = "error"` in the dashboard's Query Builder.
//
// The sink is swappable because stdout is the MCP transport in local stdio
// mode (src/local.ts redirects to stderr) and tests silence it.

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogSink = (level: LogLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

let sink: LogSink = consoleSink;

export function setLogSink(next: LogSink): void {
  sink = next;
}

export function log(event: string, fields: LogFields = {}, level: LogLevel = "info"): void {
  try {
    sink(level, JSON.stringify({ event, level, ...fields }));
  } catch {
    // Logging must never break a request.
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import type { SessionProps } from "../auth/session";
import { registerSeveraServer } from "./register";

export class SeveraMcpAgent extends McpAgent<Env, Record<string, never>, SessionProps> {
  server = new McpServer({ name: "severa-mcp", version: "0.1.0" });

  async init(): Promise<void> {
    const props = this.props;
    if (!props) throw new Error("SeveraMcpAgent.init() called without session props");
    // Never throws on Severa/KV failures — see REGISTRATION_FALLBACK.
    await registerSeveraServer(this.server, this.env, props);
  }
}

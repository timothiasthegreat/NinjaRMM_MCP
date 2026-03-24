import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { NinjaClient } from "./ninja-client.js";
import { registerReadOnlyTools } from "./tools.js";

const config = loadConfig(process.env);
const ninjaClient = new NinjaClient(config);

const app = express();
app.use(express.json({ limit: "1mb" }));

type SessionRuntime = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, SessionRuntime>();

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.all("/mcp", async (req, res) => {
  try {
    const sessionIdHeader = req.header("mcp-session-id");
    let runtime = sessionIdHeader ? sessions.get(sessionIdHeader) : undefined;

    if (sessionIdHeader && !runtime) {
      res.status(404).json({ error: "Unknown MCP session" });
      return;
    }

    if (!runtime) {
      const server = new McpServer(
        {
          name: "ninjarmm-mcp-server",
          version: "0.1.0",
        },
        {
          instructions:
            "Read-only NinjaRMM MCP server. Use the provided tools for inventory, device lookup, query reports, and ticket retrieval.",
        },
      );

      registerReadOnlyTools(server, ninjaClient, config);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { server, transport });
        },
        onsessionclosed: async (sessionId) => {
          const existing = sessions.get(sessionId);
          if (existing) {
            sessions.delete(sessionId);
            await existing.server.close();
          }
        },
      });

      transport.onerror = (error) => {
        console.error("MCP transport error", error);
      };

      transport.onclose = async () => {
        const id = transport?.sessionId;
        if (id) {
          const existing = sessions.get(id);
          if (existing) {
            sessions.delete(id);
            await existing.server.close();
          }
        }
      };

      await server.connect(transport);
      runtime = { server, transport };
    }

    await runtime.transport.handleRequest(req, res, req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error("MCP request failed", message);

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Ninja MCP server listening on 0.0.0.0:${config.port}`);
});

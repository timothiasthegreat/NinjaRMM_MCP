import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NinjaApiError, NinjaClient, type QueryParams } from "./ninja-client.js";

const QUERY_REPORTS = {
  antivirus_status: "/v2/queries/antivirus-status",
  device_health: "/v2/queries/device-health",
  disks: "/v2/queries/disks",
  os_patches: "/v2/queries/os-patches",
  software: "/v2/queries/software",
  software_patches: "/v2/queries/software-patches",
  volumes: "/v2/queries/volumes",
  windows_services: "/v2/queries/windows-services",
} as const;

const QueryReportSchema = z.enum([
  "antivirus_status",
  "device_health",
  "disks",
  "os_patches",
  "software",
  "software_patches",
  "volumes",
  "windows_services",
]);

export function registerReadOnlyTools(server: McpServer, client: NinjaClient, config: AppConfig): void {
  server.registerTool(
    "list_organizations",
    {
      title: "List Organizations",
      description: "List organizations from NinjaRMM/NinjaOne.",
      inputSchema: {
        pageSize: z.number().int().min(1).optional(),
        after: z.number().int().min(0).optional(),
      },
    },
    async ({ pageSize, after }) => {
      return callAndFormat(client, "/v2/organizations", {
        pageSize: normalizePageSize(pageSize, config),
        after,
      });
    },
  );

  server.registerTool(
    "list_organization_devices",
    {
      title: "List Organization Devices",
      description: "List devices for a Ninja organization.",
      inputSchema: {
        organizationId: z.number().int().positive(),
        pageSize: z.number().int().min(1).optional(),
        after: z.number().int().min(0).optional(),
      },
    },
    async ({ organizationId, pageSize, after }) => {
      return callAndFormat(client, `/v2/organization/${organizationId}/devices`, {
        pageSize: normalizePageSize(pageSize, config),
        after,
      });
    },
  );

  server.registerTool(
    "get_device",
    {
      title: "Get Device",
      description: "Get detailed information for a Ninja device.",
      inputSchema: {
        deviceId: z.number().int().positive(),
      },
    },
    async ({ deviceId }) => {
      return callAndFormat(client, `/v2/device/${deviceId}`);
    },
  );

  server.registerTool(
    "run_query_report",
    {
      title: "Run Query Report",
      description: "Run a supported read-only Ninja query endpoint.",
      inputSchema: {
        report: QueryReportSchema,
        pageSize: z.number().int().min(1).optional(),
        cursor: z.string().optional(),
        organizationIds: z.array(z.number().int().positive()).optional(),
      },
    },
    async ({ report, pageSize, cursor, organizationIds }) => {
      const path = QUERY_REPORTS[report];
      return callAndFormat(client, path, {
        pageSize: normalizePageSize(pageSize, config),
        cursor,
        organizationIds,
      });
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get Ticket",
      description: "Get a Ninja ticket by ID.",
      inputSchema: {
        ticketId: z.number().int().positive(),
      },
    },
    async ({ ticketId }) => {
      return callAndFormat(client, `/v2/ticketing/ticket/${ticketId}`);
    },
  );
}

async function callAndFormat(client: NinjaClient, path: string, query: QueryParams = {}): Promise<CallToolResult> {
  try {
    const data = await client.get(path, query);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
      structuredContent: {
        path,
        data,
      },
    };
  } catch (error) {
    if (error instanceof NinjaApiError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: error.message,
                status: error.status,
                path: error.path,
                retryable: error.retryable,
                details: error.details,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const unknownError = error instanceof Error ? error.message : "Unknown error";

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: unknownError,
        },
      ],
    };
  }
}

function normalizePageSize(pageSize: number | undefined, config: AppConfig): number {
  const size = pageSize ?? config.defaultPageSize;
  return Math.max(1, Math.min(size, config.maxPageSize));
}

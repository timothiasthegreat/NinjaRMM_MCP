# NinjaRMM MCP Server

Read-only MCP server for NinjaRMM or NinjaOne, optimized for Docker Compose deployment and remote MCP clients.

## What this server exposes

- MCP endpoint: `/mcp` (Streamable HTTP transport)
- Health endpoint: `/healthz`

## Docker Compose deployment

### Option 1: Build locally

Use [docker-compose.yml](docker-compose.yml) when deploying from this source repository.

```bash
docker compose up -d --build
```

### Option 2: Deploy from published image

Use [docker-compose.deploy.example.yml](docker-compose.deploy.example.yml) when deploying from a prebuilt image.

```bash
docker compose -f docker-compose.deploy.example.yml up -d
```

## Environment variables

Create `.env` from [.env.example](.env.example), then set values.

Required:

- `NINJA_BASE_URL`

Choose at least one auth mode:

- Static bearer token: `NINJA_BEARER_TOKEN`
- Session key cookie: `NINJA_SESSION_KEY`
- OAuth2 client credentials:
- `NINJA_OAUTH_TOKEN_URL`
- `NINJA_OAUTH_CLIENT_ID`
- `NINJA_OAUTH_CLIENT_SECRET`

Optional OAuth fields:

- `NINJA_OAUTH_SCOPE`
- `NINJA_OAUTH_AUDIENCE`

Optional runtime tuning:

- `NINJA_HTTP_TIMEOUT_MS`
- `NINJA_HTTP_RETRY_COUNT`
- `NINJA_DEFAULT_PAGE_SIZE`
- `NINJA_MAX_PAGE_SIZE`
- `PORT` (default `3000`)

## Generic MCP client config

Most MCP clients support an `mcp.json` with a server entry like this:

```json
{
  "mcpServers": {
    "ninjarmm": {
      "transport": "streamable_http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For remote deployments, replace `localhost` with your host name or IP.

## Server description for AI agents

Use the following description when configuring this MCP server in AI agent platforms:

This is a read-only NinjaRMM or NinjaOne MCP server for IT operations and endpoint visibility.
It connects to the Ninja Public API v2 and exposes inventory and reporting tools over MCP Streamable HTTP.
The server endpoint is /mcp and health endpoint is /healthz.
Authentication to Ninja is provided by environment variables using one of these modes: bearer token, session key, or OAuth2 client credentials.
This server is intended for safe retrieval workflows such as listing organizations, listing devices, getting device details, reading tickets, and running supported query reports.
Do not use this server for mutating actions because this implementation is read-only by design.

## Generic MCP config with gateway auth

If your reverse proxy or API gateway requires auth, add headers:

```json
{
  "mcpServers": {
    "ninjarmm": {
      "transport": "streamable_http",
      "url": "https://mcp.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer REPLACE_WITH_GATEWAY_TOKEN"
      }
    }
  }
}
```

## Quick verification

After container start:

1. Confirm service is running: `docker compose ps`
2. Confirm health endpoint responds on port `3000`
3. Connect MCP client to `http://<host>:3000/mcp`

## Security notes

- Keep `.env` out of Git.
- Use TLS and access controls for internet-facing deployments.
- This server is read-only by design.

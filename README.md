# NinjaRMM MCP Server (Docker + Remote Agents)

This project provides a read-only MCP server for NinjaRMM/NinjaOne APIs.
It is designed to run in Docker and be reachable by remote MCP clients over HTTP.

## Features

- Streamable HTTP MCP endpoint at `/mcp`
- Health endpoint at `/healthz`
- Read-only tools:
  - `list_organizations`
  - `list_organization_devices`
  - `get_device`
  - `run_query_report`
  - `get_ticket`
- API authentication via bearer token, OAuth2 client credentials, and/or `sessionKey` cookie
- Retry/timeout controls for upstream Ninja API calls

## Environment variables

Copy `.env.example` to `.env` and configure:

- `NINJA_BASE_URL` (required)
- Auth mode A (static token): `NINJA_BEARER_TOKEN`
- Auth mode B (session cookie): `NINJA_SESSION_KEY`
- Auth mode C (OAuth2 client credentials):
  - `NINJA_OAUTH_TOKEN_URL`
  - `NINJA_OAUTH_CLIENT_ID`
  - `NINJA_OAUTH_CLIENT_SECRET`
  - Optional: `NINJA_OAUTH_SCOPE`, `NINJA_OAUTH_AUDIENCE`
- `NINJA_HTTP_TIMEOUT_MS` (optional)
- `NINJA_HTTP_RETRY_COUNT` (optional)
- `NINJA_DEFAULT_PAGE_SIZE` (optional)
- `NINJA_MAX_PAGE_SIZE` (optional)
- `PORT` (optional, default `3000`)

At least one auth mode must be configured.

## Local development

```bash
npm install
npm run dev
```

## Build and run (Docker)

```bash
docker build -t ninjarmm-mcp:latest .
docker run --rm -p 3000:3000 --env-file .env ninjarmm-mcp:latest
```

Or with Compose:

```bash
docker compose up -d --build
```

## Deployment compose example

For host deployments that pull a prebuilt image instead of building locally, use [docker-compose.deploy.example.yml](docker-compose.deploy.example.yml).

1. Update the image value in [docker-compose.deploy.example.yml](docker-compose.deploy.example.yml) to your published image tag.
2. Ensure your `.env` file is present on the target host.
3. Start the service:

```bash
docker compose -f docker-compose.deploy.example.yml up -d
```

## Remote agent access

Your remote agents should use:

- MCP URL: `http://<host>:3000/mcp`
- Health check: `http://<host>:3000/healthz`

For internet-facing deployments, place this container behind a reverse proxy with TLS and access control.

## MCP connection config examples (mcp.json)

The server uses Streamable HTTP transport. Most MCP clients can connect with an `mcp.json` entry that points to your `/mcp` URL.

### Claude-style mcp.json

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

### LM Studio mcp.json

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

### mcp.json with gateway auth header

If you put the MCP server behind a reverse proxy or gateway that requires an API key or bearer token, include headers:

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

Notes:

- Replace `localhost` with your Docker host name or IP for remote clients.
- Keep TLS enabled for non-local access.
- If your MCP client uses a different key than `mcpServers`, adapt the same server object fields (`transport`, `url`, optional `headers`).

## Tool details

### list_organizations
Inputs:
- `pageSize` (optional number)
- `after` (optional number)

### list_organization_devices
Inputs:
- `organizationId` (number)
- `pageSize` (optional number)
- `after` (optional number)

### get_device
Inputs:
- `deviceId` (number)

### run_query_report
Inputs:
- `report` (enum): `antivirus_status`, `device_health`, `disks`, `os_patches`, `software`, `software_patches`, `volumes`, `windows_services`
- `pageSize` (optional number)
- `cursor` (optional string)
- `organizationIds` (optional number[])

### get_ticket
Inputs:
- `ticketId` (number)

## Security notes

- This release is read-only by design.
- Secrets are read from environment variables; do not commit `.env`.
- Error responses are structured for clients but avoid intentional secret exposure.

## Known limitations

- Ninja API pagination models vary by endpoint; tools normalize only the included v1 endpoints.
- The OpenAPI source does not define `servers`, so `NINJA_BASE_URL` must be set correctly per tenant/environment.

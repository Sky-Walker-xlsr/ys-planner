import { serverEnv } from '@/lib/env'
import { MCP_SCOPE, mcpServerUrl } from '@/lib/mcp/oauth'

// RFC 9728: wo sich Clients für den MCP-Endpunkt anmelden
export function GET() {
  return Response.json({
    resource: mcpServerUrl(),
    authorization_servers: [serverEnv.appUrl],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'ys-planner',
  })
}

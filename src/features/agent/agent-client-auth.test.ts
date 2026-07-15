import { describe, expect, it } from 'vitest'

import { buildAgentClientAuthGuide, buildConnectionCommand } from './agent-client-auth'

const url = 'https://jovlo.8xd.io/mcp/connection-1'

describe('Agent client account commands', () => {
  it('logs Codex out locally and replaces the old account-bound server', () => {
    const guide = buildAgentClientAuthGuide('codex', url)

    expect(guide.logout).toBe('codex mcp logout jovlo')
    expect(guide.replace).toContain('codex mcp remove jovlo')
    expect(guide.replace).toContain(`codex mcp add jovlo --url ${url}`)
    expect(guide.replace).toContain('codex mcp login jovlo')
  })

  it('uses Claude local authentication clearing before adding the target trip', () => {
    const guide = buildAgentClientAuthGuide('claude', url)

    expect(guide.logout).toContain('Clear authentication')
    expect(guide.replace).toContain('claude mcp remove --scope user jovlo')
    expect(guide.replace).toContain(`claude mcp add --transport http --scope user jovlo ${url}`)
    expect(guide.replaceNote).toContain('Clear authentication')
    expect(guide.replaceNote).toContain('Authenticate')
  })

  it('keeps the generic client configuration on standard Streamable HTTP', () => {
    const command = buildConnectionCommand('generic', url)

    expect(command).toContain('streamable-http')
    expect(command).toContain(url)
  })
})

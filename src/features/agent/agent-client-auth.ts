export type AgentClientKind = 'codex' | 'claude' | 'generic'

export type AgentClientAuthGuide = {
  logout: string
  logoutNote: string
  replace: string
  replaceNote: string
}

export function buildConnectionCommand(kind: AgentClientKind, url: string) {
  if (kind === 'codex') return `codex mcp add jovlo --url ${url}\ncodex mcp login jovlo`
  if (kind === 'claude') return `claude mcp add --transport http --scope user jovlo ${url}\nclaude mcp login jovlo`
  return JSON.stringify({
    mcpServers: {
      jovlo: { type: 'streamable-http', url },
    },
  }, null, 2)
}

export function buildAgentClientAuthGuide(kind: AgentClientKind, url: string): AgentClientAuthGuide {
  if (kind === 'codex') {
    return {
      logout: 'codex mcp logout jovlo',
      logoutNote: '清除这台设备上 Codex 保存的 Jovlo OAuth 登录；MCP 地址仍会保留。',
      replace: `codex mcp logout jovlo\ncodex mcp remove jovlo\ncodex mcp add jovlo --url ${url}\ncodex mcp login jovlo`,
      replaceNote: '清除旧登录和旧地址，再用当前账号、当前路书的新连接重新授权。',
    }
  }
  if (kind === 'claude') {
    return {
      logout: 'claude mcp logout jovlo',
      logoutNote: '清除这台设备上 Claude Code 保存的 Jovlo OAuth 登录；MCP 地址仍会保留。',
      replace: `claude mcp logout jovlo\nclaude mcp remove --scope user jovlo\nclaude mcp add --transport http --scope user jovlo ${url}\nclaude mcp login jovlo`,
      replaceNote: '清除旧登录和旧地址，再用当前账号、当前路书的新连接重新授权。',
    }
  }
  return {
    logout: '在 MCP 客户端中删除 Jovlo 的本地 OAuth 凭据。',
    logoutNote: '不同客户端的入口名称可能是 Log out、Clear authentication 或 Forget credentials。',
    replace: `1. 删除旧 Jovlo MCP 服务与本地 OAuth 凭据\n2. 用下面的配置重新添加 Jovlo\n${buildConnectionCommand(kind, url)}\n3. 在浏览器完成 Jovlo 登录授权`,
    replaceNote: '目标客户端必须支持 Streamable HTTP 与 OAuth 2.1。',
  }
}

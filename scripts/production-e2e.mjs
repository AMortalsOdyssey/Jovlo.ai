import { spawnSync } from "node:child_process";

import { chromium } from "playwright";

const ORIGIN = process.env.JOVLO_E2E_ORIGIN?.trim() || "https://jovlo.8xd.io";
const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF?.trim() || "hqtkehqtuxdeovdlexic";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const CONFIRM_FLAG = "--confirm-production";

if (!process.argv.includes(CONFIRM_FLAG)) {
  throw new Error(
    `生产 E2E 会临时创建并删除两个 Supabase 用户。确认后请添加 ${CONFIRM_FLAG}。`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadApiKeys() {
  const result = spawnSync(
    "npx",
    [
      "supabase",
      "projects",
      "api-keys",
      "--project-ref",
      PROJECT_REF,
      "--output",
      "json",
    ],
    { cwd: process.cwd(), encoding: "utf8", env: process.env },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    throw new Error("无法读取 Supabase 生产 API keys，请先登录 Supabase CLI。");
  }

  const keys = JSON.parse(result.stdout);
  const publishable = keys.find((item) => item.type === "publishable")?.api_key;
  const serviceRole = keys.find(
    (item) => item.type === "legacy" && item.name === "service_role",
  )?.api_key;
  assert(
    publishable && serviceRole,
    "Supabase 项目没有返回 production E2E 所需的 keys。",
  );
  return { publishable, serviceRole };
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text.slice(0, 240) };
  }
}

async function adminRequest(serviceRole, path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await readResponse(response);
  if (!response.ok) {
    throw new Error(`Supabase Admin ${init.method || "GET"} ${path} 返回 ${response.status}：${body?.message || "未知错误"}`);
  }
  return body;
}

async function createTestUser(serviceRole, role, runId, password) {
  return adminRequest(serviceRole, "/users", {
    method: "POST",
    body: JSON.stringify({
      email: `jovlo-e2e-${role}-${runId}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { purpose: "jovlo-production-e2e", role, runId },
    }),
  });
}

async function deleteTestUser(serviceRole, userId) {
  if (!userId) return;
  await adminRequest(serviceRole, `/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

async function signInDirect(email, password, publishableKey) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await readResponse(response);
  assert(response.ok && body?.access_token, `Supabase 测试登录返回 ${response.status}：${body?.message || "登录失败"}`);
  return body;
}

async function api(path, { token, method = "GET", body, idempotencyKey } = {}) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, envelope: await readResponse(response) };
}

async function mcp(connectionId, { token, method, params = {}, id = 1 } = {}) {
  const response = await fetch(`${ORIGIN}/mcp/${encodeURIComponent(connectionId)}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return {
    status: response.status,
    body: await readResponse(response),
    authenticate: response.headers.get("www-authenticate"),
  };
}

async function waitForInitialTrip(token) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await api("/api/v1/trips", { token });
    const trip = Array.isArray(result.envelope?.data) ? result.envelope.data[0] : null;
    if (result.status === 200 && (trip?.current_version_id || trip?.currentVersionId)) {
      return trip;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("登录后 30 秒内没有完成初始路书与首个版本创建。");
}

function publicationToken(result, label) {
  assert(result.status === 201, `${label}创建返回 ${result.status}：${result.envelope?.error?.message || "未知错误"}`);
  const token = result.envelope?.data?.token;
  assert(typeof token === "string" && token.length >= 24, `${label}没有返回有效 token。`);
  return token;
}

const keys = loadApiKeys();
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const password = `Jv!${crypto.randomUUID()}Aa1`;
let owner;
let visitor;
let browser;
let resultSummary;

try {
  owner = await createTestUser(keys.serviceRole, "owner", runId, password);
  visitor = await createTestUser(keys.serviceRole, "visitor", runId, password);
  assert(owner?.id && owner?.email && visitor?.id && visitor?.email, "测试用户创建结果不完整。");

  const ownerSession = await signInDirect(owner.email, password, keys.publishable);
  const visitorSession = await signInDirect(visitor.email, password, keys.publishable);
  const ownerToken = ownerSession.access_token;
  const visitorToken = visitorSession.access_token;

  const unverifiedLogin = await fetch(
    `${ORIGIN}/supabase/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, password }),
    },
  );
  assert(unverifiedLogin.status === 403, `未完成人机验证的登录应为 403，实际为 ${unverifiedLogin.status}。`);

  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({ viewport: { width: 447, height: 669 } });
  await ownerContext.addInitScript((session) => {
    window.localStorage.setItem("sb-jovlo-auth-token", JSON.stringify(session));
  }, ownerSession);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${ORIGIN}/trips`, { waitUntil: "networkidle" });
  await ownerPage.waitForURL(`${ORIGIN}/trips`, { timeout: 20_000 });

  const tripRow = await waitForInitialTrip(ownerToken);
  const tripId = tripRow.id;
  const versionId = tripRow.current_version_id || tripRow.currentVersionId;
  assert(typeof tripId === "string" && typeof versionId === "string", "初始路书缺少稳定 ID。");

  const detail = await api(`/api/v1/trips/${encodeURIComponent(tripId)}`, { token: ownerToken });
  assert(detail.status === 200, `所有者读取路书返回 ${detail.status}。`);
  const snapshot = detail.envelope?.data?.draft?.snapshot;
  const revision = detail.envelope?.data?.draft?.revision;
  assert(snapshot?.days?.length > 1 && Number.isInteger(revision), "生产路书草稿结构不完整。");

  const connection = await api(`/api/v1/trips/${encodeURIComponent(tripId)}/mcp-connections`, {
    token: ownerToken,
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {},
  });
  assert(connection.status === 201 && connection.envelope?.data?.id, `MCP 连接创建返回 ${connection.status}。`);
  const connectionId = connection.envelope.data.id;
  const anonymousMcp = await mcp(connectionId, {
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "E2E", version: "1" } },
  });
  assert(anonymousMcp.status === 401 && anonymousMcp.authenticate?.includes("resource_metadata"), "MCP 未返回标准 OAuth challenge。");
  const visitorConnections = await api(`/api/v1/trips/${encodeURIComponent(tripId)}/mcp-connections`, { token: visitorToken });
  assert(visitorConnections.status === 403, `其他账号读取 MCP 连接应为 403，实际为 ${visitorConnections.status}。`);
  const initializedMcp = await mcp(connectionId, {
    token: ownerToken,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Jovlo production E2E", version: "1" } },
  });
  assert(initializedMcp.status === 200 && initializedMcp.body?.result?.serverInfo?.name === "Jovlo", "MCP initialize 失败。");
  assert(initializedMcp.body?.result?.instructions?.includes("绝不删除历史") && initializedMcp.body?.result?.instructions?.includes("confirmMajorChange=true"), "MCP initialize 未返回完整 Agent 协作说明。");
  const tools = await mcp(connectionId, { token: ownerToken, method: "tools/list", id: 2 });
  const toolNames = tools.body?.result?.tools?.map((tool) => tool.name) ?? [];
  assert(tools.status === 200 && toolNames.length === 6 && toolNames.includes("jovlo_apply_trip_changes"), "MCP tools/list 不完整。");
  const mcpTrip = await mcp(connectionId, {
    token: ownerToken,
    method: "tools/call",
    id: 3,
    params: { name: "jovlo_get_trip", arguments: {} },
  });
  const mcpTripData = mcpTrip.body?.result?.structuredContent;
  assert(mcpTrip.status === 200 && Number.isInteger(mcpTripData?.revision), "MCP 读取路书失败。");
  assert(Array.isArray(mcpTripData?.suggestions) && mcpTripData.suggestions.length <= 2, "MCP 没有返回精简的上下文建议。");
  const mcpWrite = await mcp(connectionId, {
    token: ownerToken,
    method: "tools/call",
    id: 4,
    params: {
      name: "jovlo_apply_trip_changes",
      arguments: {
        expectedRevision: mcpTripData.revision,
        idempotencyKey: crypto.randomUUID(),
        message: "生产 E2E：验证 Agent 小版本",
        operations: [{ type: "update_trip", patch: { title: `${snapshot.title} · E2E` } }],
        confirmMajorChange: false,
      },
    },
  });
  const mcpWriteData = mcpWrite.body?.result?.structuredContent;
  assert(mcpWrite.status === 200 && !mcpWrite.body?.result?.isError && mcpWriteData?.classification?.level === "minor", "MCP 小版本写入失败。");
  assert(Array.isArray(mcpWriteData?.reminders) && mcpWriteData.reminders[0]?.includes(`v${mcpWriteData.versionNo}`), "MCP 写入后没有返回版本提醒。");
  const mcpVersions = await mcp(connectionId, {
    token: ownerToken,
    method: "tools/call",
    id: 5,
    params: { name: "jovlo_list_versions", arguments: { limit: 5 } },
  });
  const versionRows = mcpVersions.body?.result?.structuredContent?.versions;
  assert(Array.isArray(versionRows) && versionRows[0]?.classification?.label === "小版本", "MCP 版本历史缺少语义分级。");
  const revokeConnection = await api(`/api/v1/mcp-connections/${encodeURIComponent(connectionId)}`, {
    token: ownerToken,
    method: "DELETE",
    idempotencyKey: crypto.randomUUID(),
  });
  assert(revokeConnection.status === 200, `MCP 连接撤销返回 ${revokeConnection.status}。`);
  const revokedMcp = await mcp(connectionId, { token: ownerToken, method: "tools/list", id: 6 });
  assert(revokedMcp.status === 403, `撤销后的 MCP 应为 403，实际为 ${revokedMcp.status}。`);

  const overview = await api(`/api/v1/trips/${encodeURIComponent(tripId)}/publications`, {
    token: ownerToken,
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {
      versionId,
      disclosureConfig: {
        showExactDates: false,
        showSources: true,
        showBudget: true,
        viewScope: "overview",
      },
    },
  });
  const overviewToken = publicationToken(overview, "总览分享");

  const day = await api(`/api/v1/trips/${encodeURIComponent(tripId)}/publications`, {
    token: ownerToken,
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {
      versionId,
      disclosureConfig: {
        showExactDates: false,
        showSources: true,
        showBudget: true,
        viewScope: "day",
        dayId: snapshot.days[0].id,
        overviewToken,
      },
    },
  });
  const dayToken = publicationToken(day, "单天分享");

  const publicOverview = await api(`/api/v1/public/${encodeURIComponent(overviewToken)}`);
  assert(publicOverview.status === 200, `匿名总览分享返回 ${publicOverview.status}。`);
  assert(
    publicOverview.envelope?.data?.snapshot?.days?.length === snapshot.days.length,
    "匿名总览分享没有返回完整天数。",
  );

  const publicDay = await api(`/api/v1/public/${encodeURIComponent(dayToken)}`);
  assert(publicDay.status === 200, `匿名单天分享返回 ${publicDay.status}。`);
  assert(publicDay.envelope?.data?.snapshot?.days?.length === 1, "单天分享泄露了其他天数据。");
  assert(publicDay.envelope?.data?.view?.overviewToken === overviewToken, "单天分享没有关联总览。" );

  const visitorRead = await api(`/api/v1/trips/${encodeURIComponent(tripId)}`, { token: visitorToken });
  assert(visitorRead.status === 403, `其他账号读取私有路书应为 403，实际为 ${visitorRead.status}。`);

  const visitorWrite = await api(`/api/v1/trips/${encodeURIComponent(tripId)}/draft`, {
    token: visitorToken,
    method: "PUT",
    idempotencyKey: crypto.randomUUID(),
    body: { revision, snapshot },
  });
  assert(visitorWrite.status === 403, `其他账号修改私有路书应为 403，实际为 ${visitorWrite.status}。`);

  const visitorRevoke = await api(
    `/api/v1/publications/${encodeURIComponent(day.envelope.data.publicationId || day.envelope.data.publication_id)}`,
    { token: visitorToken, method: "DELETE", idempotencyKey: crypto.randomUUID() },
  );
  assert(visitorRevoke.status === 403, `其他账号撤销分享应为 403，实际为 ${visitorRevoke.status}。`);

  const publicContext = await browser.newContext({ viewport: { width: 447, height: 669 } });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`${ORIGIN}/s/${encodeURIComponent(dayToken)}`, { waitUntil: "networkidle" });
  await publicPage.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
  const overviewLink = publicPage.getByRole("link", { name: "查看整份路书", exact: true });
  assert((await overviewLink.count()) === 1, "单天分享页缺少返回总览入口。" );
  assert((await overviewLink.getAttribute("href")) === `/s/${overviewToken}`, "总览入口指向错误。" );
  assert((await publicPage.locator('[aria-label^="打开来源："]').count()) > 0, "公开路书没有来源外链。" );
  const publicUi = await publicPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    text: document.body.innerText,
  }));
  assert(!publicUi.overflow, "单天分享页在 447px 手机宽度发生横向溢出。" );
  assert(!publicUi.text.includes("保存版本") && !publicUi.text.includes("编辑路书"), "只读分享页出现写操作。" );
  assert(!publicUi.text.includes("人机验证"), "公开分享页不应出现人机验证。" );

  const publicationId = day.envelope.data.publicationId || day.envelope.data.publication_id;
  const revoke = await api(`/api/v1/publications/${encodeURIComponent(publicationId)}`, {
    token: ownerToken,
    method: "DELETE",
    idempotencyKey: crypto.randomUUID(),
  });
  assert(revoke.status === 200, `所有者撤销分享返回 ${revoke.status}。`);
  const revoked = await api(`/api/v1/public/${encodeURIComponent(dayToken)}`);
  assert(revoked.status === 410, `撤销后的分享应为 410，实际为 ${revoked.status}。`);

  resultSummary = {
    ok: true,
    origin: ORIGIN,
    checks: [
      "邮箱密码会话恢复与首次路书创建",
      "登录接口缺少 Turnstile 时拒绝",
      "MCP OAuth、能力说明、上下文建议、小版本写入、版本分级、账号隔离与撤销",
      "总览固定分享",
      "单天服务端过滤与总览跳转",
      "匿名只读访问",
      "其他已登录账号读取/修改/撤销均被拒绝",
      "来源外链与手机宽度",
      "所有者撤销后返回 410",
      "测试用户清理",
    ],
  };
} finally {
  if (browser) await browser.close();
  const cleanupErrors = [];
  for (const user of [visitor, owner]) {
    try {
      await deleteTestUser(keys.serviceRole, user?.id);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (cleanupErrors.length) {
    throw new Error(`生产 E2E 测试用户清理失败：${cleanupErrors.join("；")}`);
  }
}

process.stdout.write(`${JSON.stringify(resultSummary, null, 2)}\n`);

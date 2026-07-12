import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = "ses.tencentcloudapi.com";
const SERVICE = "ses";
const VERSION = "2020-10-02";
const IDENTITY = "auth.8xd.io";
const SENDER = "no-reply@auth.8xd.io";
const ENV_PATH = resolve(".env.tencent.local");

const templates = [
  {
    envName: "TENCENT_SES_SIGNUP_TEMPLATE_ID",
    name: "Jovlo 注册验证",
    path: resolve("tencent/templates/signup.html"),
  },
  {
    envName: "TENCENT_SES_RECOVERY_TEMPLATE_ID",
    name: "Jovlo 密码重置",
    path: resolve("tencent/templates/recovery.html"),
  },
  {
    envName: "TENCENT_SES_ALERT_TEMPLATE_ID",
    name: "Jovlo 运行告警",
    path: resolve("tencent/templates/provider-alert.html"),
  },
];

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const localEnvText = readFileSync(ENV_PATH, "utf8");
const localEnv = { ...parseEnv(localEnvText), ...process.env };
const REGION = localEnv.TENCENT_SES_REGION?.trim() || "ap-hongkong";
const secretId = localEnv.TENCENTCLOUD_SECRET_ID?.trim();
const secretKey = localEnv.TENCENTCLOUD_SECRET_KEY?.trim();
if (!secretId || !secretKey) {
  throw new Error(".env.tencent.local 缺少腾讯云 SecretId 或 SecretKey。");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function authorization(payload, timestamp) {
  const algorithm = "TC3-HMAC-SHA256";
  const date = new Date(timestamp * 1_000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\n`;
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  return `${algorithm} Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function call(action, body = {}) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1_000);
  const response = await fetch(`https://${HOST}/`, {
    method: "POST",
    headers: {
      authorization: authorization(payload, timestamp),
      "content-type": "application/json; charset=utf-8",
      host: HOST,
      "x-tc-action": action,
      "x-tc-region": REGION,
      "x-tc-timestamp": String(timestamp),
      "x-tc-version": VERSION,
    },
    body: payload,
  });
  const json = await response.json();
  const api = json.Response || {};
  if (!response.ok || api.Error) {
    const code = api.Error?.Code || `HTTP_${response.status}`;
    const message = api.Error?.Message || "腾讯云 API 请求失败";
    throw new Error(`${action}: ${code} - ${message}`);
  }
  return api;
}

function updateEnv(values) {
  const current = readFileSync(ENV_PATH, "utf8");
  const nextLines = current.trimEnd().split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const index = nextLines.findIndex((line) => line.startsWith(`${name}=`));
    const line = `${name}=${value}`;
    if (index >= 0) nextLines[index] = line;
    else nextLines.push(line);
  }
  writeFileSync(ENV_PATH, `${nextLines.join("\n")}\n`, { mode: 0o600 });
}

function templateStatusLabel(status) {
  if (status === 0) return "已通过";
  if (status === 1) return "审核中";
  if (status === 2) return "已拒绝";
  return `不可用(${status})`;
}

async function ensureIdentity() {
  const list = await call("ListEmailIdentities", { Limit: 100, Offset: 0 });
  const found = list.EmailIdentities?.find((item) => item.IdentityName === IDENTITY);
  if (!found) {
    await call("CreateEmailIdentity", { EmailIdentity: IDENTITY, DKIMOption: 1 });
    process.stdout.write(`已创建发信域名 ${IDENTITY}。\n`);
  } else {
    process.stdout.write(`发信域名 ${IDENTITY} 已存在。\n`);
  }
  return call("GetEmailIdentity", { EmailIdentity: IDENTITY });
}

async function ensureTemplates() {
  const list = await call("ListEmailTemplates", { Limit: 100, Offset: 0 });
  const ids = {};
  for (const definition of templates) {
    let found = list.TemplatesMetadata?.find((item) => item.TemplateName === definition.name);
    if (!found) {
      const html = readFileSync(definition.path);
      const created = await call("CreateEmailTemplate", {
        TemplateName: definition.name,
        TemplateContent: { Html: html.toString("base64") },
      });
      found = { TemplateID: created.TemplateID, TemplateStatus: 1 };
      process.stdout.write(`已提交模板：${definition.name}（审核中）。\n`);
    } else {
      process.stdout.write(
        `模板已存在：${definition.name}（${templateStatusLabel(found.TemplateStatus)}）。\n`,
      );
    }
    ids[definition.envName] = String(found.TemplateID);
  }
  updateEnv({ TENCENT_SES_REGION: REGION, ...ids });
  return list.TemplatesMetadata || [];
}

async function ensureSender(identity) {
  const senders = await call("ListEmailAddress", {});
  const exists = senders.EmailSenders?.some((item) => item.EmailAddress === SENDER);
  if (exists) {
    process.stdout.write(`发信地址 ${SENDER} 已存在。\n`);
    return;
  }
  if (!identity.VerifiedForSendingStatus) {
    process.stdout.write("发信域名尚未验证，暂不创建发信地址。\n");
    return;
  }
  await call("CreateEmailAddress", {
    EmailAddress: SENDER,
    EmailSenderName: "Jovlo.ai",
  });
  process.stdout.write(`已创建发信地址 ${SENDER}。\n`);
}

function printIdentity(identity) {
  process.stdout.write(
    `域名状态：${identity.VerifiedForSendingStatus ? "已验证" : "等待 DNS 验证"}\n`,
  );
  for (const attribute of identity.Attributes || []) {
    process.stdout.write(
      `${attribute.Status ? "[通过]" : "[待配置]"} ${attribute.Type} ${attribute.SendDomain}\n${attribute.ExpectedValue}\n`,
    );
  }
}

async function main() {
  const command = process.argv[2] || "bootstrap";
  let identity = await ensureIdentity();
  if (command === "verify") {
    await call("UpdateEmailIdentity", { EmailIdentity: IDENTITY });
    identity = await call("GetEmailIdentity", { EmailIdentity: IDENTITY });
  }
  if (command !== "status") await ensureTemplates();
  printIdentity(identity);
  await ensureSender(identity);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_ENV_PATH = resolve(".env.tencent.local");

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

const localEnv = existsSync(LOCAL_ENV_PATH)
  ? parseEnv(readFileSync(LOCAL_ENV_PATH, "utf8"))
  : {};
const config = { ...localEnv, ...process.env };

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF?.trim() || "hqtkehqtuxdeovdlexic";

function required(name) {
  const value = config[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}。`);
  return value;
}

function persistLocalValue(name, value) {
  if (!existsSync(LOCAL_ENV_PATH)) return;
  const lines = readFileSync(LOCAL_ENV_PATH, "utf8").trimEnd().split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  const next = `${name}=${value}`;
  if (index >= 0) lines[index] = next;
  else lines.push(next);
  writeFileSync(LOCAL_ENV_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function putWorkerSecret(name, value) {
  run("npx", ["wrangler", "secret", "put", name], {
    input: `${value}\n`,
  });
}

try {
  const hookSecret =
    config.SUPABASE_SEND_EMAIL_HOOK_SECRET?.trim() ||
    `v1,whsec_${randomBytes(32).toString("base64")}`;
  persistLocalValue("SUPABASE_SEND_EMAIL_HOOK_SECRET", hookSecret);
  const secrets = {
    SUPABASE_SEND_EMAIL_HOOK_SECRET: hookSecret,
    TENCENTCLOUD_SECRET_ID: required("TENCENTCLOUD_SECRET_ID"),
    TENCENTCLOUD_SECRET_KEY: required("TENCENTCLOUD_SECRET_KEY"),
    TENCENT_SES_SIGNUP_TEMPLATE_ID: required("TENCENT_SES_SIGNUP_TEMPLATE_ID"),
    TENCENT_SES_RECOVERY_TEMPLATE_ID: required("TENCENT_SES_RECOVERY_TEMPLATE_ID"),
    TENCENT_SES_ALERT_TEMPLATE_ID: required("TENCENT_SES_ALERT_TEMPLATE_ID"),
    TENCENT_SES_REGION: config.TENCENT_SES_REGION?.trim() || "ap-hongkong",
    TENCENT_SES_FROM:
      config.TENCENT_SES_FROM?.trim() ||
      "Jovlo.ai <no-reply@auth.8xd.io>",
    TENCENT_SES_REPLY_TO:
      config.TENCENT_SES_REPLY_TO?.trim() || "founder@8xd.io",
    ALERT_EMAIL_TO: config.ALERT_EMAIL_TO?.trim() || "founder@8xd.io",
  };

  process.stdout.write("写入 Jovlo Worker 邮件密钥与配置。\n");
  for (const [name, value] of Object.entries(secrets)) putWorkerSecret(name, value);

  if (!process.argv.includes("--secrets-only")) {
    process.stdout.write("启用 Supabase Send Email Hook。\n");
    run("npx", ["supabase", "config", "push", "--project-ref", PROJECT_REF], {
      env: { ...process.env, SUPABASE_SEND_EMAIL_HOOK_SECRET: hookSecret },
    });
  } else {
    process.stdout.write("模板审核期间暂不启用 Supabase Send Email Hook。\n");
  }
  process.stdout.write("邮件投递配置完成。密钥未写入仓库。\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

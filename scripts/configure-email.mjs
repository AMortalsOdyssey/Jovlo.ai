import { spawnSync } from "node:child_process";

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF?.trim() || "hqtkehqtuxdeovdlexic";
const DOMAIN = "8xd.io";
const smtpToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();

if (!smtpToken) {
  process.stderr.write(
    "缺少 CLOUDFLARE_EMAIL_API_TOKEN。请创建具有 Email Sending: Edit 权限的 Cloudflare API Token 后再执行。\n",
  );
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

process.stdout.write(`检查 ${DOMAIN} 的 Cloudflare Email Sending 状态。\n`);
run("npx", ["wrangler", "email", "sending", "settings", DOMAIN]);

process.stdout.write("推送 Supabase SMTP 与中文认证邮件模板。\n");
run("npx", [
  "supabase",
  "config",
  "push",
  "--project-ref",
  PROJECT_REF,
]);

process.stdout.write("Cloudflare SMTP 已配置到 Supabase Auth。\n");

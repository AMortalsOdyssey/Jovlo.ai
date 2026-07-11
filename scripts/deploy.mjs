import { spawnSync } from "node:child_process";

const DEFAULT_SUPABASE_PROJECT_REF = "hqtkehqtuxdeovdlexic";
const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() || DEFAULT_SUPABASE_PROJECT_REF;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveSupabaseConfig() {
  const configuredUrl = process.env.VITE_SUPABASE_URL?.trim();
  const configuredKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (configuredUrl && configuredKey) {
    return { url: configuredUrl, key: configuredKey };
  }

  const keyResult = spawnSync(
    "npx",
    [
      "supabase",
      "projects",
      "api-keys",
      "--project-ref",
      projectRef,
      "--output",
      "json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );

  if (keyResult.status !== 0) {
    process.stderr.write(keyResult.stderr || "");
    throw new Error(
      "无法读取 Supabase 发布密钥。请先登录 Supabase CLI，或设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY。",
    );
  }

  const keys = JSON.parse(keyResult.stdout);
  const publishableKey = keys.find((item) => item.type === "publishable")?.api_key;

  if (!publishableKey) {
    throw new Error("Supabase 项目未返回 publishable key，已停止部署。");
  }

  return {
    url: configuredUrl || `https://${projectRef}.supabase.co`,
    key: configuredKey || publishableKey,
  };
}

try {
  const supabase = resolveSupabaseConfig();
  process.env.VITE_SUPABASE_URL = supabase.url;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = supabase.key;

  process.stdout.write("已加载 Jovlo.ai 生产配置，开始构建与部署。\n");
  run("npm", ["run", "build"]);
  run("npx", ["wrangler", "deploy"]);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

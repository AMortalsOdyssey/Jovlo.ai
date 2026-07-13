# Jovlo

![Jovlo](brand/current/jovlo-logo-preview.png)

Jovlo 是面向真实旅行决策的路书产品，围绕出发前做攻略与行程中执行、调整两种状态，并支持路线编辑、地图联动、预算、来源证据、版本恢复、分享与行程报告。当前 MVP 以海南东线自驾作为一条完整示例路书。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。未配置外部密钥时，应用使用明确标注的本地演示数据与参考路线，不冒充真实 Supabase 或高德结果。

## 验证

```bash
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
```

## 技术栈

- React 19、Vite 7、TypeScript、Zustand、TanStack Query
- Cloudflare Workers、Hono
- Supabase/Postgres/PostGIS migration、RLS、事务 RPC
- Vitest、Testing Library、Playwright

## 环境

复制 `.env.example` 中的公开变量，并通过 `wrangler secret put` 配置服务端密钥。默认 `wrangler.jsonc` 不包含任何凭据。

项目规划、架构、设计与实施记录统一保存在项目 Obsidian 文档库中，不在代码仓库重复维护。

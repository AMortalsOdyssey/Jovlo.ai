import { expect, test } from '@playwright/test'

const tripId = '10000000-0000-4000-8000-000000000001'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('planner stays usable without horizontal page overflow', async ({ page }, testInfo) => {
  await page.goto(`/trips/${tripId}/plan`)
  await expect(page.getByRole('heading', { name: /Day 1/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '当日路线时间轴' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存版本' })).toHaveCount(0)

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '更多命令' }).click()
    await expect(page.getByRole('menuitem', { name: '下载 PDF' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Agent 协作' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '地图', exact: true }).click()
    await expect(page.getByRole('region', { name: '路线地图' })).toBeVisible()
    await page.getByRole('button', { name: '预算', exact: true }).click()
    await expect(page.getByRole('region', { name: '预算摘要' })).toBeVisible()
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await expect(page.getByRole('navigation', { name: '更多功能' })).toBeVisible()
  } else {
    await page.getByRole('button', { name: '选择第 1 站：海口骑楼老街' }).click()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '海口骑楼老街' })).toBeVisible()
    await page.getByLabel('停留时长（分钟）').fill('150')
    await page.getByRole('button', { name: '保存并重算' }).click()
    await expect(page.getByRole('button', { name: '选择第 1 站：海口骑楼老街' })).toContainText('2h 30m')
    await expect(page.getByRole('button', { name: '下载 PDF' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Agent 协作' })).toBeVisible()
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('legacy import address now opens the focused MCP Agent flow', async ({ page }) => {
  await page.goto(`/trips/${tripId}/imports/demo-import`)
  await expect(page).toHaveURL(`/trips/${tripId}/agent`)
  await expect(page.getByRole('heading', { name: 'Agent 协作' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Agent 连接流程' })).toContainText('建立 MCP 连接')
  await expect(page.getByText('开发者工具 · 手动导入变更文件')).toHaveCount(0)

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('version history opens an immutable read-only trip view', async ({ page }) => {
  await page.goto(`/trips/${tripId}/versions`)
  await expect(page.getByRole('heading', { name: '版本历史' })).toBeVisible()
  await expect(page.getByText('大版本 / 小版本判定')).toBeVisible()
  await page.getByRole('link', { name: '只读回看' }).click()
  await expect(page).toHaveURL(/\/versions\/[0-9a-f-]+$/)
  await expect(page.getByText(/只读快照 · 当前仍为 v/)).toBeVisible()
  await expect(page.getByText('你正在查看固定历史快照。切换日期、打开来源和地图不会改变当前路书。')).toBeVisible()
  await expect(page.getByRole('heading', { name: '海南东线 5 日自驾示例' })).toBeVisible()

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('Cloudflare Worker exposes the healthy fail-closed envelope', async ({ request }) => {
  const response = await request.get('/api/v1/health')
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  expect(body.error).toBeNull()
  expect(['demo', 'production']).toContain(body.meta.mode)
  expect(body.data.persistence).toBe(
    body.meta.mode === 'demo' ? 'demo-ephemeral' : 'supabase-rls-rpc',
  )
})

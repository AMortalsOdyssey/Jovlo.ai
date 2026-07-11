import { expect, test } from '@playwright/test'

const tripId = '10000000-0000-4000-8000-000000000001'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('planner stays usable without horizontal page overflow', async ({ page }, testInfo) => {
  await page.goto(`/trips/${tripId}/plan`)
  await expect(page.getByRole('heading', { name: /Day 1/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '当日路线时间轴' })).toBeVisible()

  if (testInfo.project.name === 'mobile') {
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
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('an old public token remains bound to its original version', async ({ page }) => {
  await page.goto(`/trips/${tripId}/imports/demo-import`)
  await expect(page.getByRole('heading', { name: '审阅 ChangeSet' })).toBeVisible()
  await page.getByRole('button', { name: '应用并创建新版本' }).click()
  await expect(page.getByText('已提交应用')).toBeVisible()

  await page.goto('/s/jovlo-demo-trip')
  await page.getByRole('button', { name: /Day 4/ }).click()
  await expect(page.getByText('宿 · 石梅湾舒适型酒店示例')).toBeVisible()
  await expect(page.getByText('宿 · 日月湾住宿锚点区')).toHaveCount(0)
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

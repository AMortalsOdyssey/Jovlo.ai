import type { AppContext } from '../types'
import { sendTencentTemplateEmail } from './tencent-email'

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1_000

export type ProviderIssue = {
  provider: 'amap' | 'cloudflare' | 'supabase' | 'tencent-ses'
  code: string
  message: string
  impact: string
  notifyByEmail?: boolean
}

async function persistAndShouldSend(context: AppContext, issue: ProviderIssue): Promise<boolean> {
  const database = context.env.AGENT_GRANTS
  if (!database) return issue.notifyByEmail !== false
  const key = `${issue.provider}:${issue.code}`
  const now = Date.now()
  const existing = await database
    .prepare('SELECT last_sent_at FROM provider_alerts WHERE alert_key = ?')
    .bind(key)
    .first<{ last_sent_at: number | null }>()
  const shouldSend = issue.notifyByEmail !== false
    && (!existing?.last_sent_at || now - existing.last_sent_at >= ALERT_COOLDOWN_MS)
  await database.prepare(`INSERT INTO provider_alerts (
      alert_key, provider, code, last_message, first_seen_at, last_seen_at, last_sent_at, occurrence_count
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
    ON CONFLICT(alert_key) DO UPDATE SET
      last_message = excluded.last_message,
      last_seen_at = excluded.last_seen_at,
      occurrence_count = provider_alerts.occurrence_count + 1`)
    .bind(key, issue.provider, issue.code, issue.message, now, now)
    .run()
  return shouldSend
}

async function markAlertSent(context: AppContext, issue: ProviderIssue): Promise<void> {
  const database = context.env.AGENT_GRANTS
  if (!database) return
  await database.prepare('UPDATE provider_alerts SET last_sent_at = ? WHERE alert_key = ?')
    .bind(Date.now(), `${issue.provider}:${issue.code}`)
    .run()
}

async function deliverProviderAlert(context: AppContext, issue: ProviderIssue): Promise<void> {
  console.warn(JSON.stringify({
    ts: new Date().toISOString(),
    requestId: context.get('requestId'),
    event: 'provider_issue',
    ...issue,
  }))
  let shouldSend = false
  try {
    shouldSend = await persistAndShouldSend(context, issue)
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      requestId: context.get('requestId'),
      event: 'provider_alert_store_failed',
      name: error instanceof Error ? error.name : 'UnknownError',
    }))
  }
  const templateId = Number(context.env.TENCENT_SES_ALERT_TEMPLATE_ID)
  const to = context.env.ALERT_EMAIL_TO?.trim()
  if (!shouldSend || !to || !Number.isInteger(templateId) || templateId <= 0) return
  try {
    await sendTencentTemplateEmail(context.env, {
      to,
      subject: `[Jovlo 告警] ${issue.provider} ${issue.code}`,
      templateId,
      templateData: {},
    })
    await markAlertSent(context, issue)
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      requestId: context.get('requestId'),
      event: 'provider_alert_email_failed',
      name: error instanceof Error ? error.name : 'UnknownError',
    }))
  }
}

export function reportProviderIssue(context: AppContext, issue: ProviderIssue): void {
  const task = deliverProviderAlert(context, issue)
  try {
    context.executionCtx.waitUntil(task)
  } catch {
    void task.catch(() => undefined)
  }
}

import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiErrorCode } from '../types'

export class AppError extends Error {
  readonly code: ApiErrorCode
  readonly status: ContentfulStatusCode
  readonly retryable: boolean
  readonly userAction?: string
  readonly details?: unknown

  constructor(
    code: ApiErrorCode,
    message: string,
    status: ContentfulStatusCode,
    options: { retryable?: boolean; userAction?: string; details?: unknown } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.retryable = options.retryable ?? false
    this.userAction = options.userAction
    this.details = options.details
  }
}

export function mapDatabaseError(message: string): AppError {
  const mappings: Array<[string, ApiErrorCode, ContentfulStatusCode, string]> = [
    ['DIRTY_DRAFT_REQUIRES_CHECKPOINT', 'DIRTY_DRAFT_REQUIRES_CHECKPOINT', 409, '请先发布或放弃当前草稿'],
    ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED', 409, '请为不同请求生成新的幂等键'],
    ['CHANGESET_STALE', 'CHANGESET_STALE', 409, '请基于当前版本重新预览'],
    ['BASE_VERSION_STALE', 'BASE_VERSION_STALE', 409, '请刷新并比较当前版本'],
    ['DRAFT_REVISION_STALE', 'DRAFT_REVISION_STALE', 409, '请刷新草稿后重试'],
    ['PLACE_PROPOSAL_UNRESOLVED', 'PLACE_PROPOSAL_UNRESOLVED', 409, '请先解析地点提案'],
    ['PUBLICATION_REVOKED', 'PUBLICATION_REVOKED', 410, '请联系分享者获取新链接'],
    ['PUBLICATION_NOT_FOUND', 'VALIDATION_FAILED', 404, '请检查分享链接'],
    ['CHANGESET_CONFLICT', 'CHANGESET_CONFLICT', 409, '请解决冲突后重新预览'],
    ['CHANGESET_INVALID', 'CHANGESET_INVALID', 400, '请修正 ChangeSet 后重新上传'],
    ['REPORT_GENERATION_FAILED', 'REPORT_GENERATION_FAILED', 422, '请检查报告所需记录'],
    ['VALIDATION_FAILED', 'VALIDATION_FAILED', 400, '请检查请求字段'],
    ['AUTH_REQUIRED', 'AUTH_REQUIRED', 401, '请重新登录'],
    ['FORBIDDEN', 'FORBIDDEN', 403, '请确认资源归属'],
  ]
  const mapping = mappings.find(([needle]) => message.includes(needle))
  if (mapping) {
    return new AppError(mapping[1], message, mapping[2], { userAction: mapping[3] })
  }
  return new AppError('DEPENDENCY_UNAVAILABLE', '数据库请求暂时不可用', 503, {
    retryable: true,
  })
}

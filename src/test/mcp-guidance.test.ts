import { describe, expect, it } from 'vitest'
import { DEMO_DERIVED, DEMO_TRIP, cloneJson, classifyVersionChange } from '../../packages/domain/src/index'
import {
  JOVLO_MCP_INSTRUCTIONS,
  buildDaySuggestions,
  buildTripSuggestions,
  buildWriteReminders,
} from '../../worker/services/mcp-guidance'

describe('MCP Agent guidance', () => {
  it('advertises complete capabilities and non-destructive version behavior on initialize', () => {
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('日期、出入口、人数、车辆')
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('路线、耗时、预算、天气和地图')
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('绝不删除历史')
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('confirmMajorChange=true')
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('绝不能跨账号复用')
    expect(JOVLO_MCP_INSTRUCTIONS).toContain('清除客户端本地 OAuth')
  })

  it('returns only contextual and concise suggestions while planning', () => {
    const snapshot = cloneJson(DEMO_TRIP)
    delete snapshot.intent.startDate
    delete snapshot.intent.totalBudget
    snapshot.days[0].stops[0].sourceIds = []

    const tripSuggestions = buildTripSuggestions(snapshot, DEMO_DERIVED)
    const daySuggestions = buildDaySuggestions(snapshot, DEMO_DERIVED, snapshot.days[0].id)

    expect(tripSuggestions).toHaveLength(2)
    expect(tripSuggestions.join(' ')).toContain('出发日期')
    expect(daySuggestions.length).toBeLessThanOrEqual(2)
    expect(daySuggestions.join(' ')).toContain('缺少来源')
  })

  it('reminds the Agent about the new version and rollback after a write', () => {
    const classification = classifyVersionChange(DEMO_TRIP, DEMO_TRIP, DEMO_DERIVED, DEMO_DERIVED)
    expect(buildWriteReminders(8, classification, ['路线使用参考估算'])).toEqual([
      '已生成 v8（小版本）；用户可只读回看，也可恢复任意旧版，现有历史不会被删除。',
      '需要向用户说明：路线使用参考估算',
    ])
  })
})

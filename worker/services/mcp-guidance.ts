import type {
  DerivedSnapshot,
  TripSnapshot,
  VersionChangeClassification,
} from '../../packages/domain/src/index'

export const JOVLO_MCP_INSTRUCTIONS = `Jovlo 路书协作能力
- 创建：新建连接初始只绑定 Jovlo 账号，不会预先生成空路书。用户明确提出新行程要求后，调用 jovlo_create_trip 创建完整路书并自动绑定。
- 读取：整本路书、单日安排、路线/耗时/预算派生结果和版本历史。
- 编辑：标题、日期、出入口、人数、车辆、节奏、驾驶上限、结束时间、总预算、天数、地点顺序、停留时间、住宿、预算假设、来源和备注。
- 外部能力：搜索旅行地点；路线、耗时、预算、天气和地图由 Jovlo 在写入后统一重算，禁止直接伪造派生值。
- 版本：每次成功写入立即创建版本；回看不改变当前路书；恢复/撤销会创建新版本，绝不删除历史。
- 账号：每条 MCP 连接只绑定一个 Jovlo 账号；创建成功后再固定绑定一本路书，绝不能跨账号或跨路书复用。切换账号或路书时，提醒用户先清除客户端本地 OAuth 并移除旧 MCP 地址，再到目标账号的创建页或目标路书创建新连接。

工作方式
1. 先判断是“创建新路书”还是“修改已有路书”。新建连接上使用 jovlo_create_trip；已绑定路书时，写入前先调用 jovlo_get_trip 获取最新 revision。冲突后重新读取，不覆盖新数据。
2. 用户明确要求的局部修改可直接执行。删除日期、重排多数地点或显著改变路线/耗时/预算时，先用简短影响摘要征得确认，再以 confirmMajorChange=true 提交。
3. 写入成功后告诉用户版本号、主要影响和可回退方式。只在与当前上下文有关时补充 1-2 条建议，不重复罗列能力。
4. 资料导入应保留原链接；重要地点尽量交叉验证。无法确认时标注不确定性并向用户追问。`

export function buildTripSuggestions(
  snapshot: TripSnapshot,
  derived: DerivedSnapshot | null,
): string[] {
  const suggestions: string[] = []
  const overloaded = derived?.daySchedules.filter((day) => day.health === 'overloaded') ?? []
  if (overloaded.length > 0) {
    suggestions.push(`Day ${overloaded.map((day) => day.dayIndex).join('、')} 行程偏满，可询问用户是否减少停靠或延长停留天数。`)
  }
  if (!snapshot.intent.startDate) {
    suggestions.push('尚未设置出发日期；补充日期后才能关联每日天气并校准季节性安排。')
  }
  const stops = snapshot.days.flatMap((day) => day.stops)
  const unsupported = stops.filter((stop) => stop.sourceIds.length === 0).length
  if (unsupported > 0) {
    suggestions.push(`有 ${unsupported} 个地点尚无来源，可在用户提供攻略时补充链接并做交叉验证。`)
  }
  if (!snapshot.intent.totalBudget) {
    suggestions.push('尚未设置目标总预算；涉及住宿、餐饮或交通取舍时可询问预算上限。')
  }
  return suggestions.slice(0, 2)
}

export function buildDaySuggestions(
  snapshot: TripSnapshot,
  derived: DerivedSnapshot | null,
  dayId: string,
): string[] {
  const day = snapshot.days.find((item) => item.id === dayId)
  if (!day) return []
  const schedule = derived?.daySchedules.find((item) => item.dayId === dayId)
  const suggestions: string[] = []
  if (schedule?.health === 'overloaded' || schedule?.health === 'tight') {
    suggestions.push(`Day ${day.dayIndex} 当前${schedule.health === 'overloaded' ? '超载' : '偏紧'}，调整地点或停留时间后应再次检查结束时间。`)
  }
  const unsupported = day.stops.filter((stop) => stop.sourceIds.length === 0).length
  if (unsupported > 0) suggestions.push(`Day ${day.dayIndex} 有 ${unsupported} 个地点缺少来源，可提醒用户补充攻略链接。`)
  if (day.stops.length === 0) suggestions.push(`Day ${day.dayIndex} 还没有停靠点，可以先确认当天目的地和住宿区域。`)
  return suggestions.slice(0, 2)
}

export function buildWriteReminders(
  versionNo: number,
  classification: VersionChangeClassification,
  warnings: string[],
): string[] {
  const reminders = [
    `已生成 v${versionNo}（${classification.label}）；用户可只读回看，也可恢复任意旧版，现有历史不会被删除。`,
  ]
  const important = warnings[0]
  if (important) reminders.push(`需要向用户说明：${important}`)
  return reminders
}

import { describe, expect, it } from 'vitest'
import {
  DEMO_CHANGESET,
  DEMO_IDS,
  DEMO_TRIP,
  DEMO_VERSIONS,
  TripChangeSetSchema,
  applyChangeSetToSnapshot,
  cloneJson,
  previewChangeSet,
  type TripChangeSet,
} from '../../packages/domain/src/index'

function rawChangeSetWithOperation(operation: unknown): unknown {
  const raw = cloneJson(DEMO_CHANGESET) as unknown as {
    proposalGroups: Array<{ operations: unknown[] }>
  }
  raw.proposalGroups[0].operations = [operation]
  raw.proposalGroups = [raw.proposalGroups[0]]
  return raw
}

describe('TripChangeSet operation whitelist', () => {
  it('rejects the locked-then-remove bypass at schema boundary', () => {
    const raw = cloneJson(DEMO_CHANGESET) as unknown as {
      proposalGroups: Array<{ operations: unknown[] }>
    }
    raw.proposalGroups[0].operations = [
      {
        type: 'UPDATE_STOP',
        stopId: DEMO_IDS.stops[4],
        patch: { locked: false },
      },
      {
        type: 'REMOVE_STOP',
        stopId: DEMO_IDS.stops[4],
        reason: '尝试先解锁再删除',
      },
    ]
    raw.proposalGroups = [raw.proposalGroups[0]]

    expect(TripChangeSetSchema.safeParse(raw).success).toBe(false)
    expect(() =>
      previewChangeSet(DEMO_TRIP, raw as unknown as TripChangeSet, {
        currentVersionId: DEMO_VERSIONS[1].id,
      }),
    ).toThrow()
  })

  it('rejects privateNote and every unknown UPDATE_STOP field', () => {
    const privateNote = rawChangeSetWithOperation({
      type: 'UPDATE_STOP',
      stopId: DEMO_IDS.stops[6],
      patch: { privateNote: '不得由 Agent 修改' },
    })
    const arbitrary = rawChangeSetWithOperation({
      type: 'UPDATE_STOP',
      stopId: DEMO_IDS.stops[6],
      patch: { stayMinutes: 150, ownerId: DEMO_IDS.owner },
    })
    expect(TripChangeSetSchema.safeParse(privateNote).success).toBe(false)
    expect(TripChangeSetSchema.safeParse(arbitrary).success).toBe(false)
  })

  it('blocks removing a locked stop even without the bypass operation', () => {
    const changeSet = cloneJson(DEMO_CHANGESET)
    changeSet.proposalGroups = [
      {
        groupId: 'remove-locked',
        title: '删除锁定点',
        rationale: '测试锁定保护',
        atomic: true,
        operations: [
          {
            type: 'REMOVE_STOP',
            stopId: DEMO_IDS.stops[4],
            reason: '测试',
          },
        ],
      },
    ]
    const parsed = TripChangeSetSchema.parse(changeSet)
    const preview = previewChangeSet(DEMO_TRIP, parsed, {
      currentVersionId: DEMO_VERSIONS[1].id,
    })
    expect(preview.canApply).toBe(false)
    expect(preview.proposalGroups[0].status).toBe('conflict')
    expect(
      preview.candidateSnapshot.days[2].stops.some((stop) => stop.id === DEMO_IDS.stops[4]),
    ).toBe(true)
  })
})

describe('ChangeSet atomic preview and area lodging', () => {
  it('rolls back earlier operations when a later operation in the group fails', () => {
    const changeSet = cloneJson(DEMO_CHANGESET)
    changeSet.proposalGroups = [
      {
        groupId: 'atomic-failure',
        title: '原子失败测试',
        rationale: '第一步合法，第二步触发锁定保护',
        atomic: true,
        operations: [
          {
            type: 'UPDATE_STOP',
            stopId: DEMO_IDS.stops[6],
            patch: { stayMinutes: 180 },
          },
          {
            type: 'REMOVE_STOP',
            stopId: DEMO_IDS.stops[4],
            reason: '触发原子回滚',
          },
        ],
      },
    ]
    const parsed = TripChangeSetSchema.parse(changeSet)
    const preview = previewChangeSet(DEMO_TRIP, parsed, {
      currentVersionId: DEMO_VERSIONS[1].id,
    })
    const xinglong = preview.candidateSnapshot.days[3].stops.find(
      (stop) => stop.id === DEMO_IDS.stops[6],
    )
    expect(preview.proposalGroups[0].status).toBe('conflict')
    expect(xinglong?.stayMinutes).toBe(120)
    expect(() =>
      applyChangeSetToSnapshot(DEMO_TRIP, parsed, {
        currentVersionId: DEMO_VERSIONS[1].id,
      }),
    ).toThrow(/cannot be applied/)
  })

  it('accepts SET_HOTEL with an area anchor', () => {
    const preview = previewChangeSet(DEMO_TRIP, DEMO_CHANGESET, {
      currentVersionId: DEMO_VERSIONS[1].id,
      selectedGroupIds: ['wanning-area-anchor'],
    })
    expect(preview.canApply).toBe(true)
    expect(preview.candidateSnapshot.days[3].overnightStay).toEqual({
      kind: 'area',
      areaId: DEMO_IDS.areas.wanning,
      label: '日月湾住宿锚点区',
    })
    expect(preview.impact.hotelChanges).toHaveLength(1)
  })

  it('materializes a temporary sourceRef as one stable snapshot UUID', () => {
    const changeSet = cloneJson(DEMO_CHANGESET) as unknown as Record<string, unknown>
    changeSet.sources = [
      {
        sourceRef: 'src-new-parking-note',
        platform: 'user-research',
        url: 'https://example.com/jovlo/new-source',
        title: '新的停车复核来源',
        summary: '用于验证临时 sourceRef 在预览和最终版本中映射到同一稳定 UUID。',
        commercialRelationship: 'unknown',
      },
    ]
    changeSet.proposalGroups = [
      {
        groupId: 'link-new-source',
        title: '链接新来源',
        rationale: '验证来源身份稳定性',
        atomic: true,
        operations: [
          {
            type: 'LINK_SOURCE',
            sourceRef: 'src-new-parking-note',
            stopId: DEMO_IDS.stops[6],
          },
        ],
      },
    ]
    const parsed = TripChangeSetSchema.parse(changeSet)
    const first = previewChangeSet(DEMO_TRIP, parsed, {
      currentVersionId: DEMO_VERSIONS[1].id,
    })
    const second = previewChangeSet(DEMO_TRIP, parsed, {
      currentVersionId: DEMO_VERSIONS[1].id,
    })
    const firstStop = first.candidateSnapshot.days[3].stops.find(
      (stop) => stop.id === DEMO_IDS.stops[6],
    )
    const newSourceId = firstStop?.sourceIds.find(
      (sourceId) => !DEMO_TRIP.days[3].stops[0].sourceIds.includes(sourceId),
    )
    expect(first.canApply).toBe(true)
    expect(newSourceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.candidateSnapshot.sourceRefs).toHaveProperty(newSourceId as string)
    expect(first.candidateSnapshot.sourceRefs[newSourceId as string]?.title).toBe('新的停车复核来源')
  })
})

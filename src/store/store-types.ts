import type { ActualRecord, DerivedSnapshot, Expense, TripSnapshot, TripVersion } from '@domain'

export type SaveStatus = 'saving' | 'saved' | 'failed' | 'stale'

export type ProductionSyncMode = 'demo' | 'connecting' | 'auth-required' | 'production' | 'error'

export type ProductionSyncState = {
  mode: ProductionSyncMode
  hydrated: boolean
  draftRevision: number | null
  currentVersionId: string | null
  error: string | null
}

export type ProductionPublishRequest = {
  id: string
  optimisticVersionId: string
  localRevision: number
  message: string
  source: TripVersion['source']
  snapshot: TripSnapshot
  derivedSnapshot: DerivedSnapshot
}

export type ProductionHydration = {
  snapshot: TripSnapshot
  derived: DerivedSnapshot
  versions: TripVersion[]
  draftRevision: number
  currentVersionId: string | null
}

export type MobileView = 'plan' | 'map' | 'budget' | 'more'

export type ImpactSummary = {
  title: string
  description: string
  affectedDayIds: string[]
  distanceDeltaMeters?: number
  durationDeltaMinutes?: number
  budgetDelta?: number
  warnings?: string[]
}

export type PendingAction =
  | {
      id: string
      type: 'move-stop'
      stopId: string
      sourceDayId: string
      targetDayId: string
      targetIndex: number
      impact: ImpactSummary
    }
  | {
      id: string
      type: 'set-stay'
      dayId: string
      anchor: unknown
      impact: ImpactSummary
    }
  | {
      id: string
      type: 'update-settings'
      values: Record<string, unknown>
      impact: ImpactSummary
    }
  | {
      id: string
      type: 'remove-stop'
      dayId: string
      stopId: string
      impact: ImpactSummary
    }

export type SnackbarState = {
  id: string
  message: string
  actionLabel?: string
} | null

export type DisclosureConfig = {
  showExactDates: boolean
  showSources: boolean
  showBudget: boolean
}

export type LocalPublication = {
  id: string
  token: string
  targetKind: 'version' | 'report'
  versionId: string | null
  reportId: string | null
  disclosureConfig: DisclosureConfig
  createdAt: string
  revokedAt: string | null
}

export type LocalReportSnapshot = {
  trip: TripSnapshot
  derived: DerivedSnapshot
  expenses: Expense[]
  actuals: ActualRecord[]
  frozenAt: string
}

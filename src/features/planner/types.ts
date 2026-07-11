export type SaveStatus = 'saving' | 'saved' | 'error' | 'pending-review' | 'stale'

export type DayHealthStatus = 'comfortable' | 'tight' | 'overloaded' | 'unconfirmed'

export interface DaySummary {
  id: string
  dayNumber: number
  area: string
  hotel?: string
  driveDuration: string
  riskCount?: number
  healthStatus?: DayHealthStatus
}

export type EvidenceTone = 'verified' | 'consistent' | 'single-source' | 'pending' | 'conflict'

export type TravelMode = 'driving' | 'walking' | 'pending'

export type MobilePlannerView = 'plan' | 'map' | 'budget' | 'more'

export interface Coordinate {
  lng: number
  lat: number
}

export type MapPlaceType =
  | 'scenic'
  | 'food'
  | 'coffee'
  | 'hotel'
  | 'beach'
  | 'culture'
  | 'transport'
  | 'shopping'
  | 'other'

export interface FormalMapPoint extends Coordinate {
  id: string
  order: number
  name: string
  type?: MapPlaceType
  sourceType?: string
}

export interface CandidateMapPoint extends Coordinate {
  id: string
  name: string
  type: MapPlaceType
}

import { TripSnapshotSchema, type TripSnapshot } from './schemas'

export function validateTripSnapshot(input: unknown): TripSnapshot {
  return TripSnapshotSchema.parse(input)
}

export function safeValidateTripSnapshot(input: unknown) {
  return TripSnapshotSchema.safeParse(input)
}

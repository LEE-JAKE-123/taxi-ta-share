import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { ensureDatabaseIdentity, getDatabase } from '@/lib/db/client'
import type { GeoPoint } from '@/lib/maps/contracts'
import {
  rankRecommendations,
  type RankedRecommendation,
  type RecommendationCandidate,
  type RecommendationSeed,
} from './rank'
import { parseRecommendationSeedParam } from './seed'

type SeedDatabaseRow = {
  tripId: string
  seedLocationRevision: string
  origin: string
  destination: string
  originLatitude: string
  originLongitude: string
  destinationLatitude: string
  destinationLongitude: string
  destinationProvider: string
  destinationPlaceId: string
  departureAt: string
}

type CandidateDatabaseRow = {
  tripId: string
  candidateLocationRevision: string
  hostUserId: string
  hostName: string
  origin: string
  destination: string
  originLatitude: string
  originLongitude: string
  destinationLatitude: string
  destinationLongitude: string
  destinationProvider: string
  destinationPlaceId: string
  departureAt: string
  maxParticipants: number
  approvedCount: number
  estimatedFare: number
  fareSource: string
  fareEstimateId: string
  fareLocationRevision: string
  fareCalculatedAt: string
  fareExpiresAt: string
  status: 'OPEN'
}

export type RecommendationTrace = {
  requestId: string
  traceId: string
  requestFingerprint: string | null
  policyKey: 'same-destination-recommendation'
  policyVersion: '1'
}

export type RecommendationFeed =
  | {
      status: 'NO_SEED'
      trace: RecommendationTrace
      seed: null
      recommendations: []
    }
  | {
      status: 'NO_CANDIDATES'
      trace: RecommendationTrace
      seed: RecommendationSeed
      recommendations: []
    }
  | {
      status: 'READY'
      trace: RecommendationTrace
      seed: RecommendationSeed
      recommendations: RankedRecommendation[]
      omittedForTraceFailure: number
    }
  | {
      status: 'TRACE_FAILED'
      trace: RecommendationTrace
      seed: RecommendationSeed
      recommendations: []
    }

export async function getTripRecommendations(
  userId: string,
  explicitSeedTripId?: string | null,
): Promise<RecommendationFeed> {
  const requestId = randomUUID()
  const traceId = randomUUID()
  const baseTrace = {
    requestId,
    traceId,
    policyKey: 'same-destination-recommendation',
    policyVersion: '1',
  } as const
  const selectedSeedTripId =
    explicitSeedTripId === null
      ? null
      : parseRecommendationSeedParam(explicitSeedTripId)
  if (selectedSeedTripId === null) {
    return {
      status: 'NO_SEED',
      trace: { ...baseTrace, requestFingerprint: null },
      seed: null,
      recommendations: [],
    }
  }
  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const seedRows = await sql`
    SELECT
      g.trip_id AS "tripId",
      g.location_revision AS "seedLocationRevision",
      g.origin,
      g.destination,
      g.origin_latitude AS "originLatitude",
      g.origin_longitude AS "originLongitude",
      g.destination_latitude AS "destinationLatitude",
      g.destination_longitude AS "destinationLongitude",
      g.destination_place_provider AS "destinationProvider",
      g.destination_provider_place_id AS "destinationPlaceId",
      g.departure_at AS "departureAt"
    FROM trip_groups g
    WHERE g.departure_at > now()
      AND g.status NOT IN ('CANCELLED', 'EXPIRED', 'COMPLETED')
      AND g.origin_latitude IS NOT NULL
      AND g.origin_longitude IS NOT NULL
      AND g.destination_latitude IS NOT NULL
      AND g.destination_longitude IS NOT NULL
      AND g.destination_place_provider IS NOT NULL
      AND g.destination_provider_place_id IS NOT NULL
      AND (
        (
          ${selectedSeedTripId ?? null}::text IS NOT NULL
          AND g.trip_id::text = ${selectedSeedTripId ?? null}
        )
        OR (
          ${selectedSeedTripId ?? null}::text IS NULL
          AND (
            g.host_user_id = ${userId}
            OR EXISTS (
              SELECT 1
              FROM trip_participants mine
              WHERE mine.trip_id = g.trip_id
                AND mine.user_id = ${userId}
                AND mine.status IN (
                  'APPROVED', 'DEPOSITED', 'CHECKED_IN',
                  'NO_SHOW', 'DISPUTED', 'COMPLETED'
                )
            )
          )
        )
      )
    ORDER BY g.departure_at, g.trip_id
    LIMIT 1
  `
  const seedRow = seedRows[0] as SeedDatabaseRow | undefined
  if (!seedRow) {
    return {
      status: 'NO_SEED',
      trace: { ...baseTrace, requestFingerprint: null },
      seed: null,
      recommendations: [],
    }
  }

  const seed = toSeed(seedRow)
  const trace: RecommendationTrace & { requestFingerprint: string } = {
    ...baseTrace,
    requestFingerprint: '',
  }
  const candidateRows = await sql`
    SELECT
      g.trip_id AS "tripId",
      g.location_revision AS "candidateLocationRevision",
      g.host_user_id AS "hostUserId",
      host.name AS "hostName",
      g.origin,
      g.destination,
      g.origin_latitude AS "originLatitude",
      g.origin_longitude AS "originLongitude",
      g.destination_latitude AS "destinationLatitude",
      g.destination_longitude AS "destinationLongitude",
      g.destination_place_provider AS "destinationProvider",
      g.destination_provider_place_id AS "destinationPlaceId",
      g.departure_at AS "departureAt",
      g.max_participants AS "maxParticipants",
      confirmed.count AS "approvedCount",
      f.deposit_points_total AS "estimatedFare",
      concat(f.provider_key, ':', f.fare_source) AS "fareSource",
      f.fare_estimate_id AS "fareEstimateId",
      f.trip_location_revision AS "fareLocationRevision",
      f.calculated_at AS "fareCalculatedAt",
      f.expires_at AS "fareExpiresAt",
      g.status
    FROM trip_groups g
    JOIN users host ON host.user_id = g.host_user_id
    JOIN fare_estimates f
      ON f.trip_id = g.trip_id
     AND f.fare_estimate_id = g.current_fare_estimate_id
     AND f.trip_location_revision = g.location_revision
     AND f.expires_at > now()
     AND f.deposit_points_total = g.estimated_fare
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS count
      FROM trip_participants participant
      WHERE participant.trip_id = g.trip_id
        AND participant.status IN (
          'APPROVED', 'DEPOSITED', 'CHECKED_IN',
          'NO_SHOW', 'DISPUTED', 'COMPLETED'
        )
    ) confirmed
    WHERE g.trip_id <> ${seed.tripId}
      AND g.host_user_id <> ${userId}
      AND host.account_status = 'ACTIVE'
      AND nullif(btrim(host.student_id), '') IS NOT NULL
      AND nullif(btrim(host.name), '') IS NOT NULL
      AND nullif(btrim(host.school_email), '') IS NOT NULL
      AND g.status = 'OPEN'
      AND g.departure_at > now()
      AND g.departure_at BETWEEN
        ${seed.departureAt}::timestamptz - interval '15 minutes'
        AND ${seed.departureAt}::timestamptz + interval '15 minutes'
      AND confirmed.count < g.max_participants
      AND g.origin_latitude IS NOT NULL
      AND g.origin_longitude IS NOT NULL
      AND g.destination_latitude IS NOT NULL
      AND g.destination_longitude IS NOT NULL
      AND g.destination_place_provider = ${seed.destinationProvider}
      AND g.destination_provider_place_id = ${seed.destinationPlaceId}
      AND NOT EXISTS (
        SELECT 1
        FROM trip_participants mine
        WHERE mine.trip_id = g.trip_id
          AND mine.user_id = ${userId}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM trip_participants participant
        JOIN user_blocks block ON (
          (block.blocker_user_id = ${userId}
            AND block.blocked_user_id = participant.user_id)
          OR (block.blocker_user_id = participant.user_id
            AND block.blocked_user_id = ${userId})
        )
        WHERE participant.trip_id = g.trip_id
          AND participant.user_id <> ${userId}
          AND participant.status IN (
            'APPROVED', 'DEPOSITED', 'CHECKED_IN',
            'NO_SHOW', 'DISPUTED', 'COMPLETED'
          )
      )
    ORDER BY g.departure_at, g.trip_id
    LIMIT 50
  `

  const calculatedAt = new Date().toISOString()
  trace.requestFingerprint = createHash('sha256')
    .update(
      [
        userId,
        seed.tripId,
        seed.seedLocationRevision,
        seed.departureAt,
        trace.policyVersion,
        Math.floor(Date.parse(calculatedAt) / 300_000),
      ].join('|'),
    )
    .digest('hex')
  const reusableRequestRows = await sql`
    SELECT
      request_id AS "requestId",
      trace_id AS "traceId"
    FROM trip_recommendation_evidence
    WHERE evidence_version = 2
      AND user_id = ${userId}
      AND request_fingerprint = ${trace.requestFingerprint}
      AND calculated_at > now() - interval '5 minutes'
      AND evidence_expires_at > now()
    ORDER BY calculated_at DESC
    LIMIT 1
  `
  const reusableRequest = reusableRequestRows[0] as
    | { requestId: string; traceId: string }
    | undefined
  if (reusableRequest) {
    trace.requestId = reusableRequest.requestId
    trace.traceId = reusableRequest.traceId
  }

  const recommendations = rankRecommendations(
    seed,
    (candidateRows as unknown as CandidateDatabaseRow[]).map(toCandidate),
    calculatedAt,
  )
  if (!recommendations.length) {
    return {
      status: 'NO_CANDIDATES',
      trace,
      seed,
      recommendations: [],
    }
  }

  const traced = await Promise.all(
    recommendations.map(async (recommendation) => {
      try {
        return await persistDisplayedEvidence(
          userId,
          seed,
          trace,
          recommendation,
        )
      } catch (error) {
        console.error('Recommendation evidence persistence failed.', {
          traceId: trace.traceId,
          candidateTripId: recommendation.tripId,
          error,
        })
        return null
      }
    }),
  )
  const displayable = traced.filter(
    (recommendation): recommendation is RankedRecommendation =>
      recommendation !== null,
  )
  if (!displayable.length) {
    return {
      status: 'TRACE_FAILED',
      trace,
      seed,
      recommendations: [],
    }
  }

  return {
    status: 'READY',
    trace,
    seed,
    recommendations: displayable,
    omittedForTraceFailure: recommendations.length - displayable.length,
  }
}

async function persistDisplayedEvidence(
  userId: string,
  seed: RecommendationSeed,
  trace: RecommendationTrace & { requestFingerprint: string },
  recommendation: RankedRecommendation,
) {
  const sql = getDatabase()
  const rankKey = JSON.stringify(recommendation.rankTuple)
  const reasonData = JSON.stringify(recommendation.reasonData)
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO trip_recommendation_evidence (
        evidence_version,
        request_id,
        trace_id,
        request_fingerprint,
        user_id,
        seed_trip_id,
        seed_location_revision,
        candidate_trip_id,
        candidate_location_revision,
        fare_estimate_id,
        policy_key,
        policy_version,
        origin_distance_m,
        destination_straight_distance_m,
        destination_route_distance_m,
        estimated_detour_minutes,
        detour_distance_m,
        estimated_detour_seconds,
        desired_departure_at,
        departure_delta_minutes,
        departure_delta_seconds,
        remaining_seats,
        estimated_fare,
        fare_source,
        calculation_source,
        allowed_destination_radius_m,
        is_adjacent_destination,
        destination_class,
        recommendation_reason,
        reason_template_key,
        reason_template_version,
        reason_data,
        target_participants,
        expected_share_points,
        calculated_at,
        evidence_expires_at,
        rank_position,
        rank_key
      ) VALUES (
        2,
        ${trace.requestId},
        ${trace.traceId},
        ${trace.requestFingerprint},
        ${userId},
        ${seed.tripId},
        ${seed.seedLocationRevision},
        ${recommendation.tripId},
        ${recommendation.candidateLocationRevision},
        ${recommendation.fareEstimateId},
        ${recommendation.policyKey},
        ${recommendation.policyVersion},
        ${recommendation.originDistanceMeters},
        0,
        0,
        0,
        0,
        0,
        ${seed.departureAt},
        ${recommendation.departureDeltaMinutes},
        ${recommendation.departureDeltaSeconds},
        ${recommendation.remainingSeats},
        ${recommendation.estimatedFare},
        ${recommendation.fareSource},
        ${recommendation.calculationSource},
        0,
        false,
        'EXACT',
        ${recommendation.reason},
        ${recommendation.reasonTemplateKey},
        ${recommendation.reasonTemplateVersion},
        ${reasonData}::jsonb,
        ${recommendation.maxParticipants},
        ${recommendation.expectedSharePoints},
        ${recommendation.calculatedAt},
        ${recommendation.evidenceExpiresAt},
        ${recommendation.rank},
        ${rankKey}::jsonb
      )
      ON CONFLICT (
        request_id,
        candidate_trip_id,
        fare_estimate_id
      ) WHERE evidence_version = 2
      DO NOTHING
      RETURNING calculated_at AS "calculatedAt",
                evidence_expires_at AS "evidenceExpiresAt"
    )
    SELECT "calculatedAt", "evidenceExpiresAt"
    FROM inserted
    UNION ALL
    SELECT
      existing.calculated_at AS "calculatedAt",
      existing.evidence_expires_at AS "evidenceExpiresAt"
    FROM trip_recommendation_evidence existing
    WHERE NOT EXISTS (SELECT 1 FROM inserted)
      AND existing.evidence_version = 2
      AND existing.user_id = ${userId}
      AND existing.request_id = ${trace.requestId}
      AND existing.request_fingerprint = ${trace.requestFingerprint}
      AND existing.candidate_trip_id = ${recommendation.tripId}
      AND existing.fare_estimate_id = ${recommendation.fareEstimateId}
      AND existing.seed_trip_id = ${seed.tripId}
      AND existing.seed_location_revision = ${seed.seedLocationRevision}
      AND existing.candidate_location_revision =
        ${recommendation.candidateLocationRevision}
      AND existing.policy_key = ${recommendation.policyKey}
      AND existing.policy_version = ${recommendation.policyVersion}
      AND existing.origin_distance_m = ${recommendation.originDistanceMeters}
      AND existing.destination_straight_distance_m = 0
      AND existing.destination_route_distance_m = 0
      AND existing.estimated_detour_minutes = 0
      AND existing.detour_distance_m = 0
      AND existing.estimated_detour_seconds = 0
      AND existing.desired_departure_at = ${seed.departureAt}
      AND existing.departure_delta_minutes =
        ${recommendation.departureDeltaMinutes}
      AND existing.departure_delta_seconds =
        ${recommendation.departureDeltaSeconds}
      AND existing.remaining_seats = ${recommendation.remainingSeats}
      AND existing.estimated_fare = ${recommendation.estimatedFare}
      AND existing.fare_source = ${recommendation.fareSource}
      AND existing.calculation_source =
        ${recommendation.calculationSource}
      AND existing.allowed_destination_radius_m = 0
      AND existing.is_adjacent_destination = false
      AND existing.destination_class = 'EXACT'
      AND existing.recommendation_reason = ${recommendation.reason}
      AND existing.rank_position = ${recommendation.rank}
      AND existing.rank_key = ${rankKey}::jsonb
      AND existing.reason_template_key =
        ${recommendation.reasonTemplateKey}
      AND existing.reason_template_version =
        ${recommendation.reasonTemplateVersion}
      AND existing.reason_data = ${reasonData}::jsonb
      AND existing.target_participants =
        ${recommendation.maxParticipants}
      AND existing.expected_share_points =
        ${recommendation.expectedSharePoints}
      AND existing.evidence_expires_at > now()
    LIMIT 1
  `
  const evidence = rows[0] as
    | { calculatedAt: string; evidenceExpiresAt: string }
    | undefined
  if (!evidence) return null

  return {
    ...recommendation,
    calculatedAt: evidence.calculatedAt,
    evidenceExpiresAt: evidence.evidenceExpiresAt,
  }
}

function toSeed(row: SeedDatabaseRow): RecommendationSeed {
  return {
    tripId: row.tripId,
    seedLocationRevision: row.seedLocationRevision,
    origin: row.origin,
    destination: row.destination,
    originPoint: point(row.originLatitude, row.originLongitude),
    destinationPoint: point(
      row.destinationLatitude,
      row.destinationLongitude,
    ),
    destinationProvider: row.destinationProvider,
    destinationPlaceId: row.destinationPlaceId,
    departureAt: row.departureAt,
  }
}

function toCandidate(row: CandidateDatabaseRow): RecommendationCandidate {
  return {
    tripId: row.tripId,
    candidateLocationRevision: row.candidateLocationRevision,
    hostUserId: row.hostUserId,
    hostName: row.hostName,
    origin: row.origin,
    destination: row.destination,
    originPoint: point(row.originLatitude, row.originLongitude),
    destinationPoint: point(
      row.destinationLatitude,
      row.destinationLongitude,
    ),
    destinationProvider: row.destinationProvider,
    destinationPlaceId: row.destinationPlaceId,
    departureAt: row.departureAt,
    maxParticipants: Number(row.maxParticipants),
    approvedCount: Number(row.approvedCount),
    estimatedFare: Number(row.estimatedFare),
    fareSource: row.fareSource,
    fareEstimateId: row.fareEstimateId,
    fareLocationRevision: row.fareLocationRevision,
    fareCalculatedAt: row.fareCalculatedAt,
    fareExpiresAt: row.fareExpiresAt,
    status: 'OPEN',
  }
}

function point(latitude: string, longitude: string): GeoPoint {
  return {
    crs: 'EPSG:4326',
    latitude: Number(latitude),
    longitude: Number(longitude),
  }
}

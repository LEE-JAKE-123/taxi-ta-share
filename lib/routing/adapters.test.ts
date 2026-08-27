import { afterEach, describe, expect, it, vi } from 'vitest'
import { kakaoRoutingAdapter } from './kakao'
import { naverRoutingAdapter } from './naver'

const originalKakaoKey = process.env.KAKAO_REST_API_KEY
const originalNaverId = process.env.NAVER_MAPS_CLIENT_ID
const originalNaverSecret = process.env.NAVER_MAPS_CLIENT_SECRET

afterEach(() => {
  vi.unstubAllGlobals()
  process.env.KAKAO_REST_API_KEY = originalKakaoKey
  process.env.NAVER_MAPS_CLIENT_ID = originalNaverId
  process.env.NAVER_MAPS_CLIENT_SECRET = originalNaverSecret
})

describe('Kakao routing adapter', () => {
  it('normalizes place and route units', async () => {
    process.env.KAKAO_REST_API_KEY = 'test-key'
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              {
                id: 'place-1',
                place_name: '전북대학교',
                x: '127.129',
                y: '35.846',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            routes: [
              {
                result_code: 0,
                summary: {
                  distance: 7800,
                  duration: 1200,
                  fare: { taxi: 12000 },
                },
                sections: [
                  {
                    roads: [
                      {
                        vertexes: [127.129, 35.846, 127.14, 35.85, 127.1617, 35.8584],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const [place] = await kakaoRoutingAdapter.searchPlaces('전북대학교')
    const route = await kakaoRoutingAdapter.estimateRoute(
      place,
      { latitude: 35.8584, longitude: 127.1617 },
    )

    expect(place).toMatchObject({
      provider: 'kakao',
      providerPlaceId: 'place-1',
      latitude: 35.846,
      longitude: 127.129,
    })
    expect(route).toMatchObject({
      provider: 'kakao',
      distanceMeters: 7800,
      durationSeconds: 1200,
      estimatedFareWon: 12000,
      geometry: {
        kind: 'LINE_STRING',
        points: [
          { latitude: 35.846, longitude: 127.129 },
          { latitude: 35.85, longitude: 127.14 },
          { latitude: 35.8584, longitude: 127.1617 },
        ],
      },
    })
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.has('summary')).toBe(false)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
    })
  })

  it('keeps a missing provider fare nullable', async () => {
    process.env.KAKAO_REST_API_KEY = 'test-key'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                result_code: 0,
                summary: { distance: 1000, duration: 300, fare: {} },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await kakaoRoutingAdapter.estimateRoute(
      { latitude: 35, longitude: 127 },
      { latitude: 35.1, longitude: 127.1 },
    )
    expect(result.estimatedFareWon).toBeNull()
  })
})

describe('Naver routing adapter', () => {
  it('converts duration milliseconds to integer seconds', async () => {
    process.env.NAVER_MAPS_CLIENT_ID = 'test-id'
    process.env.NAVER_MAPS_CLIENT_SECRET = 'test-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            route: {
              traoptimal: [
                {
                  summary: {
                    distance: 7800,
                    duration: 1_200_001,
                    taxiFare: 12000,
                  },
                  path: [
                    [127, 35],
                    [127.05, 35.05],
                    [127.1, 35.1],
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await naverRoutingAdapter.estimateRoute(
      { latitude: 35, longitude: 127 },
      { latitude: 35.1, longitude: 127.1 },
    )
    expect(result.durationSeconds).toBe(1201)
    expect(result.estimatedFareWon).toBe(12000)
    expect(result.geometry).toEqual({
      kind: 'LINE_STRING',
      points: [
        { latitude: 35, longitude: 127 },
        { latitude: 35.05, longitude: 127.05 },
        { latitude: 35.1, longitude: 127.1 },
      ],
    })
  })
})

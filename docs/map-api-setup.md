# 지도·경로·예상 요금 API 설정

관련 요구사항: FR-10~15, FR-20~22, FR-32, TR-04, TR-05, TR-08.

MVP 서버 지도 제공자는 카카오로 고정하며 `MAP_PROVIDER=kakao`를 사용한다.
`naver`와 `auto`는 제공자 전환 검증을 위한 어댑터 옵션으로만 유지한다. `auto`는
네이버를 먼저 호출하고 실패하면 카카오로 전환한다. 장소 검색과
자동차 경로 조회는 `/api/places`, `/api/route-estimate` Route Handler를
통해서만 수행하며 REST 키와 공급자 원본 응답은 브라우저에 전달하지 않는다.

## 환경 변수

| 변수 | 공개 여부 | 용도 |
| --- | --- | --- |
| `MAP_PROVIDER` | 서버 | Production: `kakao`; 전환 검증: `naver`, `auto` |
| `KAKAO_REST_API_KEY` | 서버 | Kakao Local·Mobility |
| `NAVER_MAPS_CLIENT_ID` | 서버 | Naver Maps API Gateway |
| `NAVER_MAPS_CLIENT_SECRET` | 서버 | Naver Maps API Gateway |
| `NEXT_PUBLIC_KAKAO_MAP_JS_KEY` | 브라우저 | Kakao Maps JavaScript SDK |

키가 없으면 서버 API는 `503`과 일반화된 설정 오류를 반환하고 화면은 이를
명시한다. 공급자 실패·시간 초과는 `502`, 검색 결과 또는 경로 없음은 `404`,
입력 오류는 `400`이다. 모든 공급자 요청은 `no-store`이며 8초 후 중단된다.

Kakao Developers의 JavaScript SDK 도메인에는 실제 고정 Production 도메인을
경로 없이 등록한다. 현재 운영 도메인은 `https://taxi-ta-share-phi.vercel.app`이다.

## 배포 확인

1. `/create`에서 출발지·목적지를 검색해 각각 결과를 선택한다.
2. 지도 마커와 거리·시간·공급자 예상 택시요금이 표시되는지 확인한다.
3. 요금이 없는 경우 방 생성 버튼이 비활성인지 확인한다.
4. `/home` 카드의 경로 조회 및 `다시 시도`를 확인한다.
5. `/room/[id]`에서 저장 좌표의 지도 마커를 확인한다.

방 생성 시 브라우저의 예상 요금은 신뢰하지 않는다. 서버가 선택 좌표로 경로를
다시 조회한 뒤 방, `fare_estimates`, `current_fare_estimate_id`를 한
트랜잭션에 저장한다.

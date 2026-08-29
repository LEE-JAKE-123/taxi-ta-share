'use client'

import { useState } from 'react'
import { ChartNoAxesCombined, Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type {
  AdminUsageGranularity,
  AdminUsageMetric,
  AdminUsagePeriod,
  AdminUsageSeriesPoint,
} from '@/lib/admin/service'

const METRICS: ReadonlyArray<{
  value: AdminUsageMetric
  label: string
  description: string
}> = [
  { value: 'TRIP_CREATED', label: '모집 생성', description: '새로 만들어진 동승 모집' },
  { value: 'POINT_GRANT_REQUESTED', label: '포인트 지급 요청', description: '접수된 관리자 지급 요청' },
  { value: 'FARE_DISPUTE_SUBMITTED', label: '실제 요금 이의', description: '제출된 실제 요금 이의' },
  { value: 'SETTLEMENT_SUBMITTED', label: '실제 요금 정산', description: '등록된 실제 요금 정산' },
]

export type AdminUsageSeries = {
  metric: AdminUsageMetric
  period: AdminUsagePeriod
  granularity: AdminUsageGranularity
  startAt: string
  observedAt: string
  points: AdminUsageSeriesPoint[]
}

export type AdminUsageSeriesByMetric = Record<AdminUsageMetric, AdminUsageSeries | null>

export function AdminDashboardVisuals({
  seriesByMetric,
}: {
  seriesByMetric: AdminUsageSeriesByMetric | null
}) {
  const [selectedMetric, setSelectedMetric] = useState<AdminUsageMetric>('TRIP_CREATED')
  const selectedDefinition = metricDefinition(selectedMetric)
  const selectedSeries = seriesByMetric?.[selectedMetric] ?? null
  const detailsId = `admin-usage-details-${selectedMetric.toLowerCase()}`

  return (
    <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-5 xl:self-start" aria-label="운영 기록 추이">
      <Card className="flex flex-col justify-center p-4 lg:min-h-36">
        <p className="text-xs font-semibold text-primary">OPERATIONS ANALYTICS</p>
        <h2 className="mt-1 text-xl font-bold tracking-[-0.02em]">최근 24시간 운영 기록</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          지표를 선택하면 시간대별 그래프와 기록 수를 확인할 수 있습니다. 모든 수치는 기록된 이벤트만 집계합니다.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3" aria-label="운영 기록 지표">
        {METRICS.map((metric) => (
          <MetricBlock
            key={metric.value}
            metric={metric}
            series={seriesByMetric?.[metric.value] ?? null}
            isSelected={selectedMetric === metric.value}
            detailsId={detailsId}
            onSelect={() => setSelectedMetric(metric.value)}
          />
        ))}
      </div>

      <Card id={detailsId} className="overflow-hidden p-0" aria-live="polite">
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-2">
            <ChartNoAxesCombined className="size-4 text-primary" aria-hidden />
            <div>
              <h3 className="font-bold">{selectedDefinition.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">최근 24시간 · 1시간 단위 · 건수 · KST</p>
            </div>
          </div>
        </div>
        {selectedSeries ? <UsageChart series={selectedSeries} metricLabel={selectedDefinition.label} /> : <UnavailableMetric metricLabel={selectedDefinition.label} />}
      </Card>
    </aside>
  )
}

function MetricBlock({
  metric,
  series,
  isSelected,
  detailsId,
  onSelect,
}: {
  metric: (typeof METRICS)[number]
  series: AdminUsageSeries | null
  isSelected: boolean
  detailsId: string
  onSelect: () => void
}) {
  const total = series ? sumCounts(series.points) : null
  return (
    <button type="button" onClick={onSelect} aria-pressed={isSelected} aria-controls={detailsId} className="rounded-[18px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className={`h-full p-4 transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-surface-subtle'}`}>
        <p className="text-xs text-muted-foreground">{metric.label}</p>
        {total === null ? <p className="mt-2 text-sm font-bold text-warn">조회 불가</p> : <p className="mt-1 text-2xl font-bold tabular-nums">{total}건</p>}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{total === null ? '선택해 재시도 안내 보기' : metric.description}</p>
      </Card>
    </button>
  )
}

function UsageChart({ series, metricLabel }: { series: AdminUsageSeries; metricLabel: string }) {
  const counts = series.points.map((point) => Number(point.count))
  const total = sumCounts(series.points)
  const maximum = Math.max(0, ...counts)
  const peakIndex = counts.findIndex((count) => count === maximum)
  const peak = series.points[peakIndex]
  const intervalDescription = `${formatDateTime(series.startAt)}부터 ${formatDateTime(series.observedAt)}까지`

  if (total === 0) {
    return (
      <div className="px-5 py-6">
        <p className="font-semibold">최근 24시간에 기록된 {metricLabel}이 없습니다.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{intervalDescription}의 각 1시간 구간은 0건입니다. 이는 기록이 없다는 뜻이며, 추정값으로 채운 데이터가 아닙니다.</p>
      </div>
    )
  }

  const graph = chartGeometry(series.points, maximum)
  const chartId = `usage-chart-${series.metric.toLowerCase()}`
  return (
    <div className="px-3 pb-4 pt-5 sm:px-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-hairline pb-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">기록 건수</dt><dd className="mt-1 text-xl font-bold tabular-nums">{total}건</dd></div>
        <div><dt className="text-xs text-muted-foreground">가장 많은 구간</dt><dd className="mt-1 font-bold tabular-nums">{maximum}건 <span className="text-xs font-medium text-muted-foreground">{formatShortDateTime(peak?.bucketStart)}</span></dd></div>
      </dl>

      <figure className="mt-4" aria-labelledby={`${chartId}-caption`}>
        <svg viewBox="0 0 720 260" className="h-auto w-full" role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
          <title id={`${chartId}-title`}>{`${metricLabel} 시간 추이 그래프`}</title>
          <desc id={`${chartId}-description`}>{intervalDescription}, 1시간 단위. 총 {total}건, 가장 많은 구간은 {maximum}건입니다.</desc>
          {[0, 0.5, 1].map((ratio) => {
            const y = graph.bottom - ratio * graph.height
            const value = Math.round(maximum * ratio)
            return <g key={ratio}><line x1={graph.left} x2={graph.right} y1={y} y2={y} className="stroke-hairline" strokeDasharray={ratio === 0 ? '0' : '3 5'} /><text x={graph.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{value}</text></g>
          })}
          <path d={graph.areaPath} className="fill-primary/10" aria-hidden />
          <path d={graph.linePath} fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden />
          {graph.coordinates.map((coordinate, index) => <circle key={series.points[index]?.bucketStart} cx={coordinate.x} cy={coordinate.y} r={coordinate.count === maximum ? 3.5 : 2} className="fill-primary" aria-hidden />)}
          <text x={graph.left} y="248" className="fill-muted-foreground text-[11px]">{formatShortDateTime(series.points[0]?.bucketStart)}</text>
          <text x={graph.right} y="248" textAnchor="end" className="fill-muted-foreground text-[11px]">{formatShortDateTime(series.points.at(-1)?.bucketStart)}</text>
        </svg>
        <figcaption id={`${chartId}-caption`} className="mt-1 text-xs leading-relaxed text-muted-foreground">{intervalDescription}에 기록된 {metricLabel}입니다. 마지막 구간은 현재 진행 중일 수 있습니다.</figcaption>
      </figure>

      <details className="mt-4 border-t border-hairline pt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">그래프 데이터 표로 보기</summary>
        <div className="mt-3 max-h-60 overflow-auto rounded-[12px] border border-hairline">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{metricLabel} 시간 구간별 기록 건수</caption>
            <thead className="bg-surface-subtle text-muted-foreground"><tr><th scope="col" className="px-3 py-2 font-semibold">구간 시작 (KST)</th><th scope="col" className="px-3 py-2 text-right font-semibold">기록 건수</th></tr></thead>
            <tbody>{series.points.map((point) => <tr key={point.bucketStart} className="border-t border-hairline"><td className="px-3 py-2">{formatDateTime(point.bucketStart)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{point.count}건</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function UnavailableMetric({ metricLabel }: { metricLabel: string }) {
  return (
    <div className="px-5 py-6" role="alert">
      <div className="flex items-center gap-2 font-semibold text-warn"><Info className="size-4" aria-hidden />{metricLabel} 데이터를 불러오지 못했습니다.</div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">다른 운영 항목은 계속 사용할 수 있습니다. 페이지를 새로고침해 이 지표를 다시 조회해 주세요.</p>
      <a href="/admin" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-bold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">다시 시도</a>
    </div>
  )
}

function metricDefinition(metric: AdminUsageMetric) {
  return METRICS.find((definition) => definition.value === metric) ?? METRICS[0]
}

function sumCounts(points: AdminUsageSeriesPoint[]) {
  return points.reduce((sum, point) => sum + Number(point.count), 0)
}

function chartGeometry(points: AdminUsageSeriesPoint[], maximum: number) {
  const left = 44
  const right = 700
  const top = 16
  const bottom = 214
  const height = bottom - top
  const width = right - left
  const safeMaximum = Math.max(maximum, 1)
  const divisor = Math.max(points.length - 1, 1)
  const coordinates = points.map((point, index) => ({ x: left + (index / divisor) * width, y: bottom - (Number(point.count) / safeMaximum) * height, count: Number(point.count) }))
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const first = coordinates[0]
  const last = coordinates.at(-1)
  const areaPath = first && last ? `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z` : ''
  return { left, right, bottom, height, coordinates, linePath, areaPath }
}

function formatDateTime(value: string | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatShortDateTime(value: string | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit' }).format(new Date(value))
}

'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Calendar, Flag, MapPin, RotateCcw, Users } from 'lucide-react'
import { createRoomAction, type CreateTripState } from '@/app/core/actions'
import { BigButton, BottomBar } from '@/components/bottom-bar'
import { MobileShell } from '@/components/mobile-shell'
import { RouteMap } from '@/components/route-map'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui/button'
import { isFreshRouteEstimate } from '@/lib/routing/estimate-preview'
import type { RouteEstimate, SelectablePlaceResult } from '@/lib/routing/types'

const initialState: CreateTripState = {}
const ROUTE_ESTIMATE_REQUEST_TIMEOUT_MS = 10_000
const TWELVE_HOUR_OPTIONS = Array.from({ length: 12 }, (_, hour) =>
  String(hour + 1).padStart(2, '0'),
)
const PERIOD_OPTIONS = ['오전', '오후']
const MINUTE_OPTIONS = Array.from({ length: 6 }, (_, minute) =>
  String(minute * 10).padStart(2, '0'),
)
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, month) =>
  String(month + 1).padStart(2, '0'),
)

export default function CreateRoomPage() {
  const [state, action, pending] = useActionState(createRoomAction, initialState)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [departure, setDeparture] = useState(() =>
    roundUpToNextTenMinutes(new Date()),
  )
  const [origin, setOrigin] = useState<SelectablePlaceResult | null>(null)
  const [destination, setDestination] = useState<SelectablePlaceResult | null>(null)
  const [estimate, setEstimate] = useState<RouteEstimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [estimateRetry, setEstimateRetry] = useState(0)
  const [estimateCheckedAt, setEstimateCheckedAt] = useState(() => Date.now())
  const [estimateStale, setEstimateStale] = useState(false)
  const estimateRequestSequence = useRef(0)
  const [maxParticipants, setMaxParticipants] = useState(3)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setIdempotencyKey(crypto.randomUUID()),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const sequence = ++estimateRequestSequence.current
    if (!origin || !destination) return

    const controller = new AbortController()
    let active = true
    let requestTimedOut = false
    let requestTimeout: number | undefined
    const timer = window.setTimeout(() => {
      if (!active || sequence !== estimateRequestSequence.current) return
      setEstimating(true)
      setEstimate(null)
      setEstimateStale(false)
      setEstimateError('')
      requestTimeout = window.setTimeout(() => {
        if (!active || sequence !== estimateRequestSequence.current) return

        requestTimedOut = true
        controller.abort()
        setEstimating(false)
        setEstimateError('경로 조회 시간이 초과되었습니다. 경로를 다시 시도해 주세요.')
      }, ROUTE_ESTIMATE_REQUEST_TIMEOUT_MS)
      fetch('/api/route-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            estimate?: RouteEstimate
            error?: string
          }
          if (!response.ok || !body.estimate) {
            throw new Error(body.error || '경로를 조회하지 못했습니다.')
          }
          if (!active || sequence !== estimateRequestSequence.current || requestTimedOut) return

          const checkedAt = Date.now()
          if (!isFreshRouteEstimate(body.estimate, checkedAt)) {
            setEstimate(null)
            setEstimateStale(true)
            return
          }
          setEstimateCheckedAt(checkedAt)
          setEstimate(body.estimate)
        })
        .catch((error: unknown) => {
          if (!active || sequence !== estimateRequestSequence.current || (error instanceof DOMException && error.name === 'AbortError')) return
          setEstimateError(
            error instanceof Error ? error.message : '경로를 조회하지 못했습니다.',
          )
        })
        .finally(() => {
          if (requestTimeout !== undefined) window.clearTimeout(requestTimeout)
          if (active && sequence === estimateRequestSequence.current) {
            setEstimating(false)
          }
        })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout)
      controller.abort()
    }
  }, [destination, estimateRetry, origin])

  useEffect(() => {
    if (!estimate) return

    const expiresAt = Date.parse(estimate.expiresAt)
    if (!Number.isFinite(expiresAt)) return

    const timer = window.setTimeout(
      () => {
        setEstimateCheckedAt(Date.now())
        setEstimate(null)
        setEstimateStale(true)
      },
      Math.max(0, expiresAt - Date.now()) + 1,
    )
    return () => window.clearTimeout(timer)
  }, [estimate])

  const minimumDeparture = roundUpToNextTenMinutes(new Date())
  const minDepartureDate = formatDateInput(minimumDeparture)
  const maxDepartureDate = formatDateInput(
    new Date(
      minimumDeparture.getFullYear(),
      minimumDeparture.getMonth() + 3,
      0,
    ),
  )
  const maximumDeparture = new Date(`${maxDepartureDate}T23:50:00`)
  const departureDate = formatDateInput(departure)
  const departureTime = formatTimeInput(departure)
  const departureAt =
    departure.getTime() >= minimumDeparture.getTime() &&
    departure.getTime() <= maximumDeparture.getTime()
      ? departure.toISOString()
      : ''
  const updateDeparture = (date: string, time: string) => {
    setDeparture(
      clampDeparture(
        new Date(`${date}T${time}:00`),
        minimumDeparture,
        maximumDeparture,
      ),
    )
  }
  const selectRelativeDeparture = (minutes: number) => {
    setDeparture((currentDeparture) => {
      const next = new Date(currentDeparture)
      next.setMinutes(next.getMinutes() + minutes)
      return clampDeparture(next, minimumDeparture, maximumDeparture)
    })
  }
  const resetDeparture = () => {
    setDeparture(
      clampDeparture(
        roundUpToNextTenMinutes(new Date()),
        minimumDeparture,
        maximumDeparture,
      ),
    )
  }
  const estimateExpired = estimateStale || Boolean(
    estimate && !isFreshRouteEstimate(estimate, estimateCheckedAt),
  )
  const displayedEstimate = estimateExpired ? null : estimate
  const canCreate = Boolean(
    idempotencyKey && origin && destination && displayedEstimate?.estimatedFareWon && departureAt,
  )

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="동승 방 만들기" subtitle="장소와 출발 조건을 입력해 주세요" backHref="/home" />
      <form action={action} className="flex flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="departureAt" value={departureAt} />
        <PlaceInputs prefix="origin" place={origin} />
        <PlaceInputs prefix="destination" place={destination} />

        <fieldset disabled={pending} className="flex flex-1 flex-col gap-6 px-4 py-5 pb-32 disabled:opacity-70 min-[391px]:px-5 lg:mx-auto lg:w-full lg:max-w-5xl lg:px-8">
          <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(28.5rem,1fr)]">
            <div className="flex min-w-0 flex-col gap-6 lg:h-full">
          <PlaceSearch label="출발지" icon={MapPin} selected={origin} onSelect={(place) => { setOrigin(place); setEstimate(null); setEstimateStale(false) }} error={state.fieldErrors?.origin?.[0]} />
          <PlaceSearch label="목적지" icon={Flag} selected={destination} onSelect={(place) => { setDestination(place); setEstimate(null); setEstimateStale(false) }} error={state.fieldErrors?.destination?.[0]} />

          <RouteMap
            origin={origin}
            destination={destination}
            geometry={displayedEstimate?.geometry}
            className="min-h-[19rem] sm:min-h-[22rem] lg:min-h-[19rem] lg:flex-1"
          />

            </div>

            <div className="flex w-full min-w-0 flex-col gap-6 lg:gap-2">
          <fieldset className="w-full min-w-0 rounded-[18px] border border-hairline bg-surface p-4 lg:p-2.5">
            <legend className="mb-2 text-sm font-bold">
              <Calendar className="mr-1.5 inline size-4" aria-hidden /> 출발 시각
            </legend>
            <div className="flex gap-2">
              {[
                { label: '+10분', minutes: 10 },
                { label: '+30분', minutes: 30 },
                { label: '+1시간', minutes: 60 },
              ].map((option) => (
                <Button
                  key={option.minutes}
                  type="button"
                  onClick={() => selectRelativeDeparture(option.minutes)}
                  variant="secondary"
                  size="xs"
                  className="flex-1"
                >
                  {option.label}
                </Button>
              ))}
              <Button
                type="button"
                onClick={resetDeparture}
                variant="secondary"
                size="icon-xs"
                className="shrink-0"
                aria-label="현재 시간으로 초기화"
                title="현재 시간으로 초기화"
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="mt-3 lg:mt-2">
              <DateTimePicker
                date={departureDate}
                time={departureTime}
                minDate={minDepartureDate}
                maxDate={maxDepartureDate}
                minTime={formatTimeInput(minimumDeparture)}
                onDateChange={(nextDate) => updateDeparture(nextDate, departureTime)}
                onTimeChange={(nextTime) => updateDeparture(departureDate, nextTime)}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground lg:mt-1">
              각 항목을 선택해 설정하세요. 시간은 10분 단위로 설정할 수 있습니다.
            </p>
          </fieldset>

          <fieldset className="w-full min-w-0 rounded-[18px] border border-hairline bg-surface p-4 lg:p-2.5">
            <legend className="mb-2 text-sm font-bold"><Users className="mr-1.5 inline size-4" aria-hidden />최대 인원</legend>
            <div className="grid grid-cols-3 gap-2">
              {[2, 3, 4].map((count) => (
                <label key={count} className="rounded-full border border-hairline bg-surface py-3 text-center text-sm font-semibold has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                  <input className="sr-only" type="radio" name="maxParticipants" value={count} checked={maxParticipants === count} onChange={() => setMaxParticipants(count)} />
                  {count}명
                </label>
              ))}
            </div>
          </fieldset>

          <RouteSummary estimate={displayedEstimate} loading={estimating} error={estimateError} expired={estimateExpired} participants={maxParticipants} onRetry={() => { setEstimateCheckedAt(Date.now()); setEstimateStale(false); setEstimateRetry((value) => value + 1) }} />

          {pending || state.message ? (
            <p className="min-h-5 text-sm text-destructive" aria-live="polite">
              {pending ? '서버에서 경로와 요금을 다시 확인하고 있습니다.' : state.message}
            </p>
          ) : null}

          </div>

          <div className="w-full min-w-0 space-y-2 rounded-[18px] border border-hairline bg-surface p-4 lg:col-span-2 lg:p-2.5">
            <label htmlFor="hostMemo" className="text-sm font-bold">
              방장 전달사항 <span className="font-normal text-muted-foreground">(선택)</span>
            </label>
            <textarea
              id="hostMemo"
              name="hostMemo"
              maxLength={60}
              rows={2}
              className="app-input min-h-20 resize-none rounded-xl px-4 py-3"
              placeholder="예: 정문 앞에서 만나요"
              aria-describedby="hostMemo-help"
            />
            <p id="hostMemo-help" className="text-xs text-muted-foreground">
              참여 희망자와 참가자에게 표시됩니다. 개인정보 없이 60자 이내로 작성해 주세요.
            </p>
            </div>
          </div>
        </fieldset>
        <BottomBar>
          <BigButton type="submit" disabled={pending || !canCreate}>
            {pending ? '방 만드는 중...' : '이 조건으로 방 만들기'}
          </BigButton>
        </BottomBar>
      </form>
    </MobileShell>
  )
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeInput(value: Date) {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function roundUpToNextTenMinutes(value: Date) {
  const next = new Date(value)
  const shouldRoundUp = next.getSeconds() > 0 || next.getMilliseconds() > 0
  next.setSeconds(0, 0)
  const remainder = next.getMinutes() % 10
  if (remainder || shouldRoundUp) {
    next.setMinutes(next.getMinutes() + 10 - remainder)
  }
  return next
}

function clampDeparture(value: Date, minimum: Date, maximum: Date) {
  if (!Number.isFinite(value.getTime()) || value < minimum) return minimum
  if (value > maximum) return maximum
  return value
}

function DateTimePicker({
  date,
  time,
  minDate,
  maxDate,
  minTime,
  onDateChange,
  onTimeChange,
}: {
  date: string
  time: string
  minDate: string
  maxDate: string
  minTime: string
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
}) {
  const [year = '0', month = '1', day = '1'] = date.split('-')
  const [hour24 = '00', minute = '00'] = time.split(':')
  const hourNumber = Number(hour24)
  const period = hourNumber >= 12 ? '오후' : '오전'
  const hour = String(hourNumber % 12 || 12).padStart(2, '0')
  const years = createNumberOptions(Number(minDate.slice(0, 4)), Number(maxDate.slice(0, 4)))
  const months = MONTH_OPTIONS.filter((option) => {
    const candidate = `${year}-${option}-01`
    return candidate.slice(0, 7) >= minDate.slice(0, 7) && candidate.slice(0, 7) <= maxDate.slice(0, 7)
  })
  const days = createNumberOptions(1, daysInMonth(Number(year), Number(month))).filter((option) => {
    const candidate = `${year}-${month}-${option}`
    return candidate >= minDate && candidate <= maxDate
  })
  const updateDate = (nextYear: string, nextMonth: string, nextDay: string) => {
    const lastDay = String(
      Math.min(Number(nextDay), daysInMonth(Number(nextYear), Number(nextMonth))),
    ).padStart(2, '0')
    onDateChange(clampDate(`${nextYear}-${nextMonth}-${lastDay}`, minDate, maxDate))
  }
  const updateTime = (nextPeriod: string, nextHour: string, nextMinute: string) => {
    onTimeChange(`${toTwentyFourHour(nextPeriod, nextHour)}:${nextMinute}`)
  }
  const isPastTime = (nextPeriod: string, nextHour: string, nextMinute: string) =>
    date === minDate && `${toTwentyFourHour(nextPeriod, nextHour)}:${nextMinute}` < minTime

  return (
    <div className="rounded-[14px] border border-hairline bg-surface p-3 sm:p-4 lg:p-2.5" aria-label="출발 일시 선택기">
      <div className="grid grid-cols-1 gap-2 min-[288px]:grid-cols-3 sm:grid-cols-6 sm:gap-1">
        <DateTimeWheel label="년" options={years} selected={year} onSelect={(next) => updateDate(next, month, day)} />
        <DateTimeWheel label="월" options={months} selected={month} onSelect={(next) => updateDate(year, next, day)} />
        <DateTimeWheel label="일" options={days} selected={day} onSelect={(next) => updateDate(year, month, next)} />
        <DateTimeWheel
          label="오전/오후"
          options={PERIOD_OPTIONS}
          selected={period}
          onSelect={(next) => updateTime(next, hour, minute)}
          isDisabled={(next) => MINUTE_OPTIONS.every((nextMinute) =>
            isPastTime(next, hour, nextMinute),
          )}
        />
        <DateTimeWheel
          label="시"
          options={TWELVE_HOUR_OPTIONS}
          selected={hour}
          onSelect={(next) => updateTime(period, next, minute)}
          isDisabled={(next) => MINUTE_OPTIONS.every((nextMinute) =>
            isPastTime(period, next, nextMinute),
          )}
        />
        <DateTimeWheel
          label="분"
          options={MINUTE_OPTIONS}
          selected={minute}
          onSelect={(next) => updateTime(period, hour, next)}
          isDisabled={(next) => isPastTime(period, hour, next)}
        />
      </div>
      <p className="mt-3 text-center text-xs font-semibold lg:mt-2" aria-live="polite">
        선택한 출발 시각: {date} {period} {hour}:{minute}
      </p>
    </div>
  )
}

function DateTimeWheel({
  label,
  options,
  selected,
  onSelect,
  isDisabled,
}: {
  label: string
  options: string[]
  selected: string
  onSelect: (value: string) => void
  isDisabled?: (value: string) => boolean
}) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedValueRef = useRef(selected)
  const wheelDeltaRef = useRef(0)
  const precisionWheelLockUntilRef = useRef(0)

  useEffect(() => {
    selectedValueRef.current = selected
  }, [selected])

  useEffect(() => {
    const wheel = wheelRef.current
    const selectedOption = wheel?.querySelector<HTMLElement>(
      `[data-wheel-value="${selected}"]`,
    )
    if (!wheel || !selectedOption) return

    // Keep picker updates inside the wheel. Element.scrollIntoView() also
    // scrolls the page, which moved the mobile form after place selection.
    wheel.scrollTo({
      top: selectedOption.offsetTop - (wheel.clientHeight - selectedOption.offsetHeight) / 2,
      behavior: 'auto',
    })
  }, [options, selected])

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
  }, [])

  const selectNearestOption = () => {
    const wheel = wheelRef.current
    if (!wheel) return

    const center = wheel.getBoundingClientRect().top + wheel.clientHeight / 2
    const nearest = Array.from(
      wheel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).reduce<HTMLButtonElement | null>((closest, option) => {
      if (!closest) return option
      const closestCenter = closest.getBoundingClientRect().top + closest.clientHeight / 2
      const optionCenter = option.getBoundingClientRect().top + option.clientHeight / 2
      return Math.abs(optionCenter - center) < Math.abs(closestCenter - center)
        ? option
        : closest
    }, null)

    const nextValue = nearest?.dataset.wheelValue
    if (nextValue) selectValue(nextValue)
  }

  const selectValue = (nextValue: string) => {
    if (nextValue === selectedValueRef.current) return
    selectedValueRef.current = nextValue
    onSelect(nextValue)
  }

  const selectAndFocus = (nextValue: string) => {
    selectValue(nextValue)
    window.requestAnimationFrame(() => {
      wheelRef.current
        ?.querySelector<HTMLButtonElement>(`[data-wheel-value="${nextValue}"]`)
        ?.focus()
    })
  }

  const getNextEnabledOption = (direction: -1 | 1) => {
    const enabledOptions = options.filter((option) => !isDisabled?.(option))
    const currentIndex = enabledOptions.indexOf(selectedValueRef.current)
    if (currentIndex < 0) return null
    const nextIndex = Math.min(
      Math.max(currentIndex + direction, 0),
      enabledOptions.length - 1,
    )
    return enabledOptions[nextIndex] ?? null
  }

  const moveSelection = (direction: -1 | 1, shouldFocus = true) => {
    const nextValue = getNextEnabledOption(direction)
    if (!nextValue || nextValue === selectedValueRef.current) return false
    if (shouldFocus) selectAndFocus(nextValue)
    else selectValue(nextValue)
    return true
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation="vertical"
      className="min-w-0"
    >
      <p className="mb-1 text-center text-[11px] font-semibold text-muted-foreground">
        {label}
      </p>
      <div className="relative rounded-lg border border-border bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-11 -translate-y-1/2 rounded-md border border-primary/30 bg-primary/10"
        />
        <div
          ref={wheelRef}
          className="h-36 snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth px-1 py-[50px] lg:h-28 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden motion-reduce:scroll-auto"
          onWheel={(event) => {
            if (!event.deltaY) return

            const viewportHeight = wheelRef.current?.clientHeight ?? 144
            const delta = event.deltaMode === 1
              ? event.deltaY * 16
              : event.deltaMode === 2
                ? event.deltaY * viewportHeight
                : event.deltaY
            const direction = delta > 0 ? 1 : -1

            // At either end, let the surrounding page receive the wheel event.
            const nextOption = getNextEnabledOption(direction)
            if (!nextOption || nextOption === selectedValueRef.current) {
              wheelDeltaRef.current = 0
              return
            }

            event.preventDefault()

            const isPrecisionWheel = event.deltaMode === 0 && Math.abs(delta) < 40
            if (!isPrecisionWheel) {
              wheelDeltaRef.current = 0
              moveSelection(direction, false)
              return
            }

            const now = event.timeStamp
            if (now < precisionWheelLockUntilRef.current) return
            if (wheelDeltaRef.current && Math.sign(wheelDeltaRef.current) !== direction) {
              wheelDeltaRef.current = 0
            }

            wheelDeltaRef.current += delta
            if (Math.abs(wheelDeltaRef.current) < 40) return

            const accumulatedDirection = wheelDeltaRef.current > 0 ? 1 : -1
            wheelDeltaRef.current = 0
            if (moveSelection(accumulatedDirection, false)) {
              precisionWheelLockUntilRef.current = now + 120
            }
          }}
          onScroll={() => {
            if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
            settleTimerRef.current = setTimeout(selectNearestOption, 120)
          }}
        >
          {options.map((option) => {
            const disabled = isDisabled?.(option) ?? false
            const isSelected = option === selected
            return (
              <button
                key={option}
                type="button"
                role="radio"
                data-wheel-value={option}
                disabled={disabled}
                aria-checked={isSelected}
                aria-label={`${label} ${option}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectValue(option)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveSelection(-1)
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveSelection(1)
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    const first = options.find((value) => !isDisabled?.(value))
                    if (first) selectAndFocus(first)
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    const last = options.findLast((value) => !isDisabled?.(value))
                    if (last) selectAndFocus(last)
                  }
                }}
                className="relative z-20 block h-11 w-full snap-center rounded-md px-1 text-center text-sm font-semibold leading-none text-foreground transition-[color,background-color,font-size] duration-150 motion-reduce:transition-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:line-through aria-checked:bg-primary aria-checked:text-[21px] aria-checked:text-primary-foreground"
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function createNumberOptions(start: number, end: number) {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) =>
    String(start + index).padStart(2, '0'),
  )
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function clampDate(value: string, minDate: string, maxDate: string) {
  if (value < minDate) return minDate
  if (value > maxDate) return maxDate
  return value
}

function toTwentyFourHour(period: string, hour: string) {
  const value = Number(hour)
  const normalized = value === 12 ? 0 : value
  const hour24 = period === '오후' ? normalized + 12 : normalized
  return String(hour24).padStart(2, '0')
}

function PlaceInputs({ prefix, place }: { prefix: 'origin' | 'destination'; place: SelectablePlaceResult | null }) {
  return <>
    <input type="hidden" name={prefix} value={place?.label ?? ''} />
    <input type="hidden" name={`${prefix}Latitude`} value={place?.latitude ?? ''} />
    <input type="hidden" name={`${prefix}Longitude`} value={place?.longitude ?? ''} />
    <input type="hidden" name={`${prefix}Provider`} value={place?.provider ?? ''} />
    <input type="hidden" name={`${prefix}ProviderPlaceId`} value={place?.providerPlaceId ?? ''} />
    <input type="hidden" name={`${prefix}SelectionToken`} value={place?.selectionToken ?? ''} />
  </>
}

function PlaceSearch({ label, icon: Icon, selected, onSelect, error }: {
  label: string
  icon: typeof MapPin
  selected: SelectablePlaceResult | null
  onSelect: (place: SelectablePlaceResult | null) => void
  error?: string
}) {
  const inputId = label === '출발지' ? 'origin-search' : 'destination-search'
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<SelectablePlaceResult[]>([])
  const [message, setMessage] = useState('')
  const [searching, setSearching] = useState(false)
  const [completedQuery, setCompletedQuery] = useState('')
  const [searchRetry, setSearchRetry] = useState(0)
  const normalizedQuery = query.trim()
  const canSearch = normalizedQuery.length >= 2 && !selected

  useEffect(() => {
    if (!canSearch) return

    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      setMessage('')
      setPlaces([])
      setCompletedQuery('')
      void fetch(`/api/places?q=${encodeURIComponent(normalizedQuery)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            places?: SelectablePlaceResult[]
            error?: string
          }
          if (!response.ok || !body.places) {
            throw new Error(body.error || '장소를 검색하지 못했습니다.')
          }
          if (active) {
            setPlaces(body.places)
            setCompletedQuery(normalizedQuery)
          }
        })
        .catch((searchError: unknown) => {
          if (!active || (searchError instanceof DOMException && searchError.name === 'AbortError')) return
          setMessage(
            searchError instanceof Error
              ? searchError.message
              : '장소를 검색하지 못했습니다.',
          )
          setCompletedQuery(normalizedQuery)
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [canSearch, normalizedQuery, searchRetry])

  return <div>
    <label htmlFor={inputId} className="mb-2 block text-sm font-bold"><Icon className="mr-1.5 inline size-4" aria-hidden />{label}</label>
    <input id={inputId} value={query} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onChange={(event) => { setQuery(event.target.value); if (selected) onSelect(null) }} maxLength={100} className="app-input app-input-search focus-visible:ring-2 focus-visible:ring-ring" placeholder={`${label} 2글자 이상 입력`} />
    {canSearch && searching ? <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">장소를 찾는 중...</p> : null}
    {canSearch && completedQuery === normalizedQuery && places.length ? <ul className="mt-2 rounded-[18px] border bg-card p-1">{places.map((place) => <li key={`${place.provider}:${place.providerPlaceId}`}><button type="button" onClick={() => { onSelect(place); setPlaces([]); setQuery(place.label) }} className="min-h-11 w-full rounded-xl px-4 py-3 text-left text-base hover:bg-muted">{place.label}</button></li>)}</ul> : null}
    {canSearch && completedQuery === normalizedQuery && !searching && !message && !places.length ? <p className="mt-2 text-xs text-muted-foreground" role="status">일치하는 장소가 없습니다.</p> : null}
    <p className="mt-1 text-xs text-destructive" role="status">{error || (canSearch ? message : '')}</p>
    {canSearch && message ? (
      <button
        type="button"
        onClick={() => setSearchRetry((value) => value + 1)}
        className="mt-2 min-h-11 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        같은 검색어로 다시 시도
      </button>
    ) : null}
  </div>
}

function RouteSummary({ estimate, loading, error, expired, participants, onRetry }: { estimate: RouteEstimate | null; loading: boolean; error: string; expired: boolean; participants: number; onRetry: () => void }) {
  if (loading) return <p className="rounded-[18px] bg-surface-subtle p-4 text-sm lg:p-2.5" role="status">경로와 예상 요금을 조회하는 중...</p>
  if (error) return <div className="rounded-[18px] border border-warning bg-warn-soft p-4 text-sm text-destructive lg:p-2.5" role="alert"><p>{error}</p><Button type="button" variant="secondary" size="sm" onClick={onRetry} className="mt-3">경로 다시 시도</Button></div>
  if (expired) return <div className="rounded-[18px] border border-warning bg-warn-soft p-4 text-sm text-destructive lg:p-2.5" role="alert" aria-live="assertive"><p>예상 경로와 요금이 만료되었습니다. 최신 정보로 다시 조회한 뒤 방을 만들 수 있습니다.</p><Button type="button" variant="secondary" size="sm" onClick={onRetry} className="mt-3">경로 다시 조회</Button></div>
  if (!estimate) return null
  return <dl className="grid grid-cols-2 gap-4 rounded-[18px] border border-hairline bg-surface p-4 text-sm lg:gap-2 lg:p-2.5">
    <div><dt className="text-xs text-muted-foreground">거리 · 시간</dt><dd className="font-bold">{(estimate.distanceMeters / 1000).toFixed(1)}km · {Math.ceil(estimate.durationSeconds / 60)}분</dd></div>
    <div><dt className="text-xs text-muted-foreground">예상 총요금</dt><dd className="font-bold">{estimate.estimatedFareWon === null ? '지도 API 요금 정보 없음' : `${estimate.estimatedFareWon.toLocaleString('ko-KR')}원`}</dd></div>
    <div className="col-span-2 border-t border-hairline pt-3"><dt className="text-xs text-muted-foreground">최대 인원 기준 1인 예치</dt><dd className="numeric mt-1 font-extrabold">{estimate.estimatedFareWon === null ? '계산할 수 없음' : `${Math.ceil(estimate.estimatedFareWon / participants).toLocaleString('ko-KR')}P`}</dd></div>
  </dl>
}

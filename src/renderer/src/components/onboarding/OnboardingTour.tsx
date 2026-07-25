import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/useSettingsStore'

export const ONBOARDING_TOUR_SETTING_KEY = 'onboarding_tour_completed_v1'
export const RESTART_ONBOARDING_TOUR_EVENT = 'octob:restart-onboarding-tour'

interface TourStep {
  title: string
  description: string
  selector?: string
}

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

const CARD_WIDTH = 380
const CARD_HEIGHT = 290
const VIEWPORT_GAP = 16
const TARGET_GAP = 14

export function OnboardingTour(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const settingsLoading = useSettingsStore((state) => state.isLoading)
  const initialSetupComplete = useSettingsStore((state) => state.initialSetupComplete)
  const openSettings = useSettingsStore((state) => state.openSettings)
  const closeSettings = useSettingsStore((state) => state.closeSettings)
  const settingsOpen = useSettingsStore((state) => state.isOpen)
  const [isVisible, setIsVisible] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null)

  const steps = useMemo<TourStep[]>(
    () => [
      {
        title: t('app.tour.welcomeTitle'),
        description: t('app.tour.welcomeDescription')
      },
      {
        title: t('app.tour.cliTitle'),
        description: t('app.tour.cliDescription'),
        selector: '[data-testid="agent-sdk-selector"]'
      },
      {
        title: t('app.tour.repositoryTitle'),
        description: t('app.tour.repositoryDescription'),
        selector: '[data-testid="dashboard-add-project"], [data-testid="add-project-button"]'
      },
      {
        title: t('app.tour.boardTitle'),
        description: t('app.tour.boardDescription'),
        selector:
          '[data-testid="sticky-board-tab"], [data-testid="workspace-mode-board"], [data-testid="kanban-board-toggle"]'
      },
      {
        title: t('app.tour.taskTitle'),
        description: t('app.tour.taskDescription'),
        selector: '[data-testid="kanban-add-ticket-card"], [data-testid="kanban-add-ticket-btn"]'
      },
      {
        title: t('app.tour.sessionsTitle'),
        description: t('app.tour.sessionsDescription'),
        selector: '[data-testid="create-session"], [data-testid="session-tabs"]'
      }
    ],
    [i18n.resolvedLanguage, t]
  )

  const finish = useCallback(async (): Promise<void> => {
    setIsVisible(false)
    setHighlightRect(null)
    if (useSettingsStore.getState().isOpen) closeSettings()
    try {
      await window.db.setting.set(ONBOARDING_TOUR_SETTING_KEY, 'true')
    } catch (error) {
      console.error('Failed to persist onboarding tour state:', error)
    }
  }, [closeSettings])

  useEffect(() => {
    if (settingsLoading || !initialSetupComplete) return

    let cancelled = false
    window.db.setting
      .get(ONBOARDING_TOUR_SETTING_KEY)
      .then((value) => {
        if (!cancelled && value !== 'true') setIsVisible(true)
      })
      .catch((error) => {
        console.error('Failed to load onboarding tour state:', error)
        if (!cancelled) setIsVisible(true)
      })

    return () => {
      cancelled = true
    }
  }, [initialSetupComplete, settingsLoading])

  useEffect(() => {
    const restart = (): void => {
      setStepIndex(0)
      setIsVisible(true)
    }
    window.addEventListener(RESTART_ONBOARDING_TOUR_EVENT, restart)
    return () => window.removeEventListener(RESTART_ONBOARDING_TOUR_EVENT, restart)
  }, [])

  useEffect(() => {
    if (!isVisible) return
    if (stepIndex === 1) {
      openSettings('general')
    } else if (settingsOpen) {
      closeSettings()
    }
  }, [closeSettings, isVisible, openSettings, settingsOpen, stepIndex])

  useEffect(() => {
    if (!isVisible) return
    const selector = steps[stepIndex]?.selector
    let frameId = 0
    let observedTarget: Element | null = null

    const updateHighlight = (): void => {
      const target = selector ? document.querySelector(selector) : null
      observedTarget = target
      if (!target) {
        setHighlightRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        setHighlightRect(null)
        return
      }
      setHighlightRect({
        top: Math.max(8, rect.top - 6),
        left: Math.max(8, rect.left - 6),
        width: rect.width + 12,
        height: rect.height + 12
      })
    }

    const scheduleUpdate = (): void => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(updateHighlight)
    }

    const initialTarget = selector ? document.querySelector(selector) : null
    initialTarget?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    scheduleUpdate()

    const mutationObserver = new MutationObserver(() => {
      const nextTarget = selector ? document.querySelector(selector) : null
      if (nextTarget !== observedTarget) scheduleUpdate()
    })
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    return () => {
      cancelAnimationFrame(frameId)
      mutationObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [isVisible, stepIndex, steps])

  useEffect(() => {
    if (!isVisible) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void finish()
      if (event.key === 'ArrowRight') {
        if (stepIndex === steps.length - 1) void finish()
        else setStepIndex((current) => current + 1)
      }
      if (event.key === 'ArrowLeft' && stepIndex > 0) {
        setStepIndex((current) => current - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [finish, isVisible, stepIndex, steps.length])

  if (!isVisible) return null

  const isLastStep = stepIndex === steps.length - 1
  const step = steps[stepIndex]
  const cardPosition = getCardPosition(highlightRect)

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none" data-testid="onboarding-tour">
      {highlightRect ? (
        <div
          className="fixed rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.68)] transition-all duration-200"
          style={highlightRect}
          aria-hidden="true"
        />
      ) : (
        <div className="fixed inset-0 bg-black/68" aria-hidden="true" />
      )}

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        className="pointer-events-auto fixed w-[380px] max-w-[calc(100vw-32px)] rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        style={cardPosition}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('app.tour.progress', { current: stepIndex + 1, total: steps.length })}
            </p>
            <h2 id="onboarding-tour-title" className="text-base font-semibold">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void finish()}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('app.tour.skip')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="min-h-16 text-sm leading-6 text-muted-foreground">{step.description}</p>

        <div className="mt-5">
          <div className="mb-4 flex gap-1" aria-hidden="true">
            {steps.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === stepIndex ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStepIndex((current) => current - 1)}>
                <ArrowLeft className="h-3.5 w-3.5" />
                {t('app.tour.back')}
              </Button>
            )}
            <Button
              size="sm"
              className="max-w-full"
              onClick={() => {
                if (isLastStep) void finish()
                else setStepIndex((current) => current + 1)
              }}
            >
              {isLastStep ? (
                <>
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('app.tour.finish')}</span>
                </>
              ) : (
                <>
                  {t('app.tour.next')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function getCardPosition(rect: HighlightRect | null): React.CSSProperties {
  if (!rect) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  let left = rect.left + rect.width + TARGET_GAP
  let top = rect.top

  if (left + CARD_WIDTH > viewportWidth - VIEWPORT_GAP) {
    left = rect.left - CARD_WIDTH - TARGET_GAP
  }
  if (left < VIEWPORT_GAP) {
    left = Math.min(
      viewportWidth - CARD_WIDTH - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, rect.left + rect.width / 2 - CARD_WIDTH / 2)
    )
    top = rect.top + rect.height + TARGET_GAP
    if (top + CARD_HEIGHT > viewportHeight - VIEWPORT_GAP) {
      top = rect.top - CARD_HEIGHT - TARGET_GAP
    }
  }

  return {
    left: Math.max(VIEWPORT_GAP, left),
    top: Math.max(VIEWPORT_GAP, Math.min(top, viewportHeight - CARD_HEIGHT - VIEWPORT_GAP))
  }
}

import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, ChevronLeft, Sparkles } from 'lucide-react'
import { AiPlanSheet } from '@/components/ai/ai-plan-sheet'
import { Chip } from '@/components/plan/chip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet } from '@/components/ui/sheet'
import { useAiStatus } from '@/lib/ai/client'
import { notifyError, notifySaved } from '@/lib/notify'
import { createPlan, type PlanTemplateData } from '@/lib/plan/api'
import { describeBlock, INTENSITY_LABELS } from '@/lib/plan/describe'
import {
  activePlanKey,
  useActivePlan,
  usePlanTemplates,
  useTrainingProfile,
} from '@/lib/plan/hooks'
import { emptyTrainingProfile, WEEKDAY_LONG, type TrainingProfileData } from '@/lib/plan/profile'
import { FAMILY_LABELS, recommendTemplate } from '@/lib/plan/recommend'
import { schedulePlan, startOptions, warningText } from '@/lib/plan/schedule'
import type { PlanFamily } from '@/lib/plan/types'
import { formatDayMonth, localDateKey } from '@/lib/progress/dates'
import { useCatalog } from '@/lib/workout/hooks'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'

export const Route = createFileRoute('/_app/plan/elegir')({
  ssr: false,
  component: ChoosePlanPage,
})

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
}

function ChoosePlanPage() {
  const { auth } = Route.useRouteContext()
  const templates = usePlanTemplates()
  const training = useTrainingProfile(auth.userId)
  const [family, setFamily] = useState<PlanFamily | 'all'>('all')
  const [level, setLevel] = useState<'all' | 'beginner' | 'intermediate'>('all')
  const [open, setOpen] = useState<PlanTemplateData | null>(null)
  const [aiRequest, setAiRequest] = useState<{ templateId: string | null; label: string } | null>(
    null,
  )
  const aiStatus = useAiStatus()
  const aiReady = aiStatus.data?.configured === true

  const profile = training.data ?? emptyTrainingProfile()
  const list = useMemo(() => templates.data ?? [], [templates.data])
  const recommended = useMemo(() => recommendTemplate(profile, list), [profile, list])
  const filtered = list.filter(
    (t) => (family === 'all' || t.family === family) && (level === 'all' || t.level === level),
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/plan"
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> Plan
      </Link>
      <h1 className="text-2xl font-bold">Elegir plan</h1>
      <p className="text-muted-foreground text-sm">
        Planes de 4 semanas: tres de progresión y una de descarga. Se reparten en tus días
        disponibles respetando tus actividades fijas.
      </p>
      {training.isSuccess && training.data === null && (
        <p className="bg-muted rounded-xl p-3 text-sm">
          Completa tu{' '}
          <Link to="/onboarding" className="text-primary font-medium underline">
            perfil de entrenamiento
          </Link>{' '}
          para que te recomendemos un plan y lo pongamos en tus días.
        </p>
      )}

      {templates.isPending ? (
        <p className="text-muted-foreground text-center">Cargando…</p>
      ) : templates.isError ? (
        <p className="text-destructive text-sm">
          No se han podido cargar los planes: {templates.error.message}
        </p>
      ) : (
        <>
          <AiCard
            ready={aiReady}
            notConfigured={aiStatus.data?.configured === false}
            left={aiStatus.data ? aiStatus.data.limit - aiStatus.data.usedToday : null}
            onAsk={() => setAiRequest({ templateId: null, label: 'Plan recomendado por la IA' })}
          />
          {recommended && (
            <Card className="border-primary gap-2">
              <CardHeader>
                <CardDescription className="text-primary flex items-center gap-1 font-medium">
                  <Sparkles className="size-4" /> Recomendado para ti
                </CardDescription>
                <CardTitle>{recommended.template.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">{recommended.reason}</p>
                <Button size="lg" onClick={() => setOpen(recommended.template)}>
                  Ver y elegir
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
              role="group"
              aria-label="Filtrar por tipo"
            >
              <Chip selected={family === 'all'} onClick={() => setFamily('all')}>
                Todos
              </Chip>
              {(Object.keys(FAMILY_LABELS) as PlanFamily[]).map((f) => (
                <Chip
                  key={f}
                  selected={family === f}
                  className="shrink-0"
                  onClick={() => setFamily(f)}
                >
                  <span aria-hidden>{FAMILY_LABELS[f].emoji} </span>
                  {FAMILY_LABELS[f].label}
                </Chip>
              ))}
            </div>
            <div className="flex gap-2" role="group" aria-label="Filtrar por nivel">
              {(['all', 'beginner', 'intermediate'] as const).map((l) => (
                <Chip key={l} selected={level === l} onClick={() => setLevel(l)}>
                  {l === 'all' ? 'Todos los niveles' : LEVEL_LABEL[l]}
                </Chip>
              ))}
            </div>
          </div>

          <ul className="flex flex-col gap-2">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpen(t)}
                  className="bg-card hover:bg-accent flex w-full flex-col gap-1 rounded-xl border p-4 text-left"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <span aria-hidden>{FAMILY_LABELS[t.family].emoji}</span>
                    {t.name}
                    {recommended?.template.id === t.id && <Badge>Recomendado</Badge>}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {LEVEL_LABEL[t.level]} · {t.days_per_week} días/semana · {t.weeks} semanas
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-sm">
                    {t.description}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="text-muted-foreground text-sm">Ningún plan con esos filtros.</li>
            )}
          </ul>
        </>
      )}

      <TemplateSheet
        template={open}
        profile={profile}
        userId={auth.userId}
        onClose={() => setOpen(null)}
        onAi={
          aiReady
            ? (t) => {
                setOpen(null)
                setAiRequest({ templateId: t.id, label: `${t.name} a tu medida` })
              }
            : null
        }
      />
      <AiPlanSheet
        request={aiRequest}
        profile={profile}
        userId={auth.userId}
        sex={auth.profile.sex}
        onClose={() => setAiRequest(null)}
      />
    </div>
  )
}

// «Personalizar con IA»: la IA parte de la plantilla recomendada (o de la que elijas) y de tu
// perfil. Sin clave configurada, la app sigue funcionando con las plantillas.
function AiCard({
  ready,
  notConfigured,
  left,
  onAsk,
}: {
  ready: boolean
  notConfigured: boolean
  left: number | null
  onAsk: () => void
}) {
  if (notConfigured) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs">
        El entrenador IA no está configurado: elige una plantilla y se adapta a tus días.
      </p>
    )
  }
  if (!ready) return null
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription className="text-primary flex items-center gap-1 font-medium">
          <Sparkles className="size-4" /> Personalizar con IA
        </CardDescription>
        <CardTitle>Un plan a tu medida</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          La IA parte de una plantilla y de tu perfil (nivel, material, molestias, carga reciente) y
          te propone 4 semanas. Lo revisas, lo editas y solo se crea si lo aceptas. También puedes
          abrir cualquier plantilla y pulsar «Personalizar con IA».
        </p>
        <Button size="lg" variant="outline" disabled={left === 0} onClick={onAsk}>
          <Sparkles /> Recomiéndame un plan
        </Button>
        {left !== null && (
          <p className="text-muted-foreground text-center text-xs">
            {left === 0
              ? 'Has usado todas las consultas de hoy'
              : `Te quedan ${left} consultas hoy`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function TemplateSheet({
  template,
  profile,
  userId,
  onClose,
  onAi,
}: {
  template: PlanTemplateData | null
  profile: TrainingProfileData
  userId: string
  onClose: () => void
  onAi: ((template: PlanTemplateData) => void) | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const active = useActivePlan(userId)
  const today = localDateKey(new Date())
  const options = startOptions(today)
  const [start, setStart] = useState(options[0]!)
  const [saving, setSaving] = useState(false)
  const name = (id: string) => catalog.byId.get(id)?.name ?? id

  const schedule = useMemo(
    () =>
      template
        ? schedulePlan({
            structure: template.structure,
            startDate: start,
            preferredDays: profile.availability.preferred_days,
            fixedActivities: profile.fixedActivities,
          })
        : null,
    [template, start, profile],
  )
  const warnings = [...new Set((schedule?.warnings ?? []).map(warningText))].slice(0, 4)
  const firstWeek = schedule?.sessions.filter((s) => s.week === 1) ?? []

  async function create() {
    if (!template || !schedule) return
    if (
      active.data &&
      !confirm(`Ya tienes el plan «${active.data.name}». ¿Sustituirlo? Lo hecho se conserva.`)
    ) {
      return
    }
    setSaving(true)
    try {
      await createPlan({
        templateId: template.id,
        name: template.name,
        startDate: start,
        sessions: schedule.sessions,
      })
      await queryClient.invalidateQueries({ queryKey: activePlanKey(userId) })
      notifySaved(`Plan creado: ${schedule.sessions.length} sesiones en 4 semanas`)
      onClose()
      await navigate({ to: '/plan', search: { semana: start } })
    } catch (error) {
      notifyError(error, 'crear el plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={template !== null}
      onClose={onClose}
      title={template?.name ?? ''}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            disabled={saving || !schedule}
            onClick={() => void create()}
          >
            <CalendarDays /> {saving ? 'Creando…' : 'Crear plan'}
          </Button>
          {onAi && template && (
            <Button
              variant="outline"
              className="w-full"
              disabled={saving}
              onClick={() => onAi(template)}
            >
              <Sparkles /> Personalizar con IA
            </Button>
          )}
        </div>
      }
    >
      {template && schedule && (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-muted-foreground text-sm">{template.description}</p>
          <p className="text-muted-foreground text-xs">{template.structure.progression_rules}</p>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Empieza el lunes…</h3>
            <div className="flex flex-wrap gap-2">
              {options.map((d) => (
                <Chip key={d} selected={start === d} onClick={() => setStart(d)}>
                  {d === today ? 'Hoy' : formatDayMonth(d)}
                </Chip>
              ))}
            </div>
          </div>

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              {warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> {w}
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Semana 1 en tus días</h3>
            <ul className="flex flex-col gap-2">
              {firstWeek.map((s) => {
                const weekday = WEEKDAY_LONG[(new Date(`${s.date}T00:00:00Z`).getUTCDay() + 6) % 7]
                return (
                  <li key={s.date + s.title} className="rounded-xl border p-3">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        <span aria-hidden>{sessionTypeEmoji(s.session_type)} </span>
                        {s.title}
                      </span>
                      <span className="text-muted-foreground inline-block shrink-0 text-xs first-letter:uppercase">
                        {weekday} {formatDayMonth(s.date)}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {s.duration_min} min · {INTENSITY_LABELS[s.intensity]}
                    </p>
                    <ul className="mt-1 text-sm">
                      {s.blocks.map((b, i) => {
                        const d = describeBlock(b, name)
                        return (
                          <li key={i}>
                            {d.title && <span className="font-medium">{d.title}: </span>}
                            {d.lines.join(' / ')}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  )
}

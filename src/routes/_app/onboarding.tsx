import { useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MapPin, X } from 'lucide-react'
import { Chip, WeekdayPicker } from '@/components/plan/chip'
import { homeOf } from '@/components/progress/achievements'
import { CitySearch } from '@/components/progress/city-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stepper } from '@/components/ui/stepper'
import { Textarea } from '@/components/ui/textarea'
import { resetAuthState } from '@/lib/auth'
import { notifyError, notifySaved } from '@/lib/notify'
import { saveTrainingProfile } from '@/lib/plan/api'
import { trainingProfileKey, useTrainingProfile } from '@/lib/plan/hooks'
import {
  emptyTrainingProfile,
  FIXED_TYPES,
  formatClockShort,
  GOAL_LABELS,
  GOALS,
  LEVEL_LABELS,
  parseMinSec,
  PLACE_LABELS,
  TRAINING_PLACES,
  type FixedActivity,
  type FixedType,
  type Goal,
  type TrainingProfileData,
} from '@/lib/plan/profile'
import { takeJustJoined } from '@/lib/invites/invite'
import { currentCommitment } from '@/lib/progress/adherence'
import { saveCommitment, updateOwnProfile, updateProfileSettings } from '@/lib/progress/api'
import { localDateKey, weekStartOf } from '@/lib/progress/dates'
import type { Home } from '@/lib/progress/equivalences'
import { commitmentsKey, useCommitments } from '@/lib/progress/hooks'
import type { Commitment } from '@/lib/progress/types'
import { parseDecimal, parseInteger } from '@/lib/workout/format'
import { EQUIPMENT_LABELS } from '@/lib/workout/labels'
import { cn } from '@/lib/utils'
import type { Profile, Sex, TrainingLevel } from '@/types/database'

export const Route = createFileRoute('/_app/onboarding')({
  ssr: false,
  component: OnboardingPage,
})

const STEPS = [
  'Objetivos',
  'Nivel y marcas',
  'Disponibilidad',
  'Material y molestias',
  'Actividades fijas',
  'Compromiso y ciudad',
] as const

// Material que se ofrece en el onboarding (el resto de la biblioteca es muy específico).
const EQUIPMENT_CHOICES = [
  'barbell',
  'rack',
  'bench',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'pullup_bar',
  'dip_bars',
  'band',
  'box',
  'medball',
  'sandbag',
  'sled',
  'skierg',
  'rower',
  'air_bike',
  'jump_rope',
  'bike',
  'pool',
  'mat',
] as const

const FIXED_LABELS: Record<FixedType, string> = {
  padel_fronton: '🎾 Frontón / pádel',
  surf: '🏄 Surf',
  yoga: '🧘 Yoga',
  other: '⚡ Otra',
}

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Mujer' },
  { value: 'male', label: 'Hombre' },
  { value: 'other', label: 'Otro' },
]

type Draft = {
  data: TrainingProfileData
  birthYear: string
  heightCm: string
  sex: Sex | null
  squat: string
  bench: string
  deadlift: string
  run5k: string
  swim100: string
  // null = sin tocar: se propone el compromiso actual o los días por semana del paso 3.
  sessions: number | null
  updateCommitment: boolean
  home: Home | null
}

function OnboardingPage() {
  const { auth } = Route.useRouteContext()
  const training = useTrainingProfile(auth.userId)
  const commitments = useCommitments(auth.userId)
  if (training.isPending || commitments.isPending) {
    return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  }
  const today = localDateKey(new Date())
  const current = commitments.data ? currentCommitment(commitments.data, today) : null
  return (
    <Wizard
      userId={auth.userId}
      profile={auth.profile}
      initial={training.data ?? null}
      current={current}
      today={today}
    />
  )
}

function initialDraft(
  profile: Profile,
  initial: TrainingProfileData | null,
  current: Commitment | null,
): Draft {
  const data = initial ?? emptyTrainingProfile()
  const kg = (v: number | null) => (v ? String(v).replace('.', ',') : '')
  return {
    data,
    birthYear: profile.birth_year ? String(profile.birth_year) : '',
    heightCm: profile.height_cm ? String(profile.height_cm) : '',
    sex: profile.sex,
    squat: kg(data.benchmarks.squat_1rm_kg),
    bench: kg(data.benchmarks.bench_1rm_kg),
    deadlift: kg(data.benchmarks.deadlift_1rm_kg),
    run5k: formatClockShort(data.benchmarks.run_5k_s),
    swim100: formatClockShort(data.benchmarks.swim_100m_s),
    sessions: null,
    updateCommitment: !current,
    home: homeOf(profile),
  }
}

function Wizard({
  userId,
  profile,
  initial,
  current,
  today,
}: {
  userId: string
  profile: Profile
  initial: TrainingProfileData | null
  current: Commitment | null
  today: string
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft>(() => initialDraft(profile, initial, current))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setData = (patch: Partial<TrainingProfileData>) =>
    setDraft((d) => ({ ...d, data: { ...d.data, ...patch } }))
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  function buildData(): TrainingProfileData | string {
    const d = draft
    const num = (v: string, label: string) => {
      if (!v.trim()) return null
      const n = parseDecimal(v)
      if (n === null || n <= 0 || n > 500) throw new Error(`${label}: valor no válido`)
      return n
    }
    const clock = (v: string, label: string) => {
      if (!v.trim()) return null
      const s = parseMinSec(v)
      if (s === null) throw new Error(`${label}: escribe minutos:segundos, p. ej. 25:30`)
      return s
    }
    try {
      return {
        ...d.data,
        benchmarks: {
          squat_1rm_kg: num(d.squat, 'Sentadilla'),
          bench_1rm_kg: num(d.bench, 'Press banca'),
          deadlift_1rm_kg: num(d.deadlift, 'Peso muerto'),
          run_5k_s: clock(d.run5k, '5K'),
          swim_100m_s: clock(d.swim100, '100 m nado'),
        },
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  // all: «Saltar todo» (guarda lo que haya y vuelve a Hoy); partial: sin compromiso ni ciudad.
  async function finish(mode: 'full' | 'partial' | 'all' = 'full') {
    const skipAll = mode === 'all'
    const data = buildData()
    if (typeof data === 'string') {
      setError(data)
      setStep(1)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveTrainingProfile(userId, data)
      if (!skipAll) {
        const birth = parseInteger(draft.birthYear)
        const height = parseInteger(draft.heightCm)
        const year = new Date().getFullYear()
        const patch: {
          birth_year?: number | null
          height_cm?: number | null
          sex?: Sex | null
        } = {}
        if (draft.sex !== profile.sex) patch.sex = draft.sex
        if (
          birth !== profile.birth_year &&
          (birth === null || (birth >= 1920 && birth <= year - 10))
        )
          patch.birth_year = birth
        if (height !== profile.height_cm && (height === null || (height >= 100 && height <= 250)))
          patch.height_cm = height
        if (Object.keys(patch).length > 0) await updateOwnProfile(userId, patch)
        const home = homeOf(profile)
        if (mode === 'full' && draft.home && draft.home.city !== home?.city) {
          await updateProfileSettings(userId, { home: draft.home })
        }
        if (
          mode === 'full' &&
          (!current || (draft.updateCommitment && sessions !== current.sessionsPerWeek))
        ) {
          const byType = current?.byType ?? null
          const typed = byType ? Object.values(byType).reduce((a, b) => a + (b ?? 0), 0) : 0
          await saveCommitment({
            validFrom: weekStartOf(today),
            sessionsPerWeek: sessions,
            minutesPerWeek: current?.minutesPerWeek ?? null,
            byType: typed <= sessions ? byType : null,
            countsFreeActivities: current?.countsFreeActivities ?? true,
          })
          await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
        }
        await resetAuthState(queryClient)
        await router.invalidate()
      }
      queryClient.setQueryData(trainingProfileKey(userId), data)
      await queryClient.invalidateQueries({ queryKey: ['equipment', userId] })
      notifySaved(
        skipAll ? 'Puedes completar tu perfil cuando quieras desde Perfil' : 'Perfil guardado',
      )
      const next = skipAll ? '/' : '/plan/elegir'
      // Recién unido con un enlace de invitación: antes, cómo instalar la app.
      if (takeJustJoined()) await navigate({ to: '/instalar', search: { next }, replace: true })
      else await navigate({ to: next, replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const last = step === STEPS.length - 1
  const d = draft.data
  const sessions = draft.sessions ?? current?.sessionsPerWeek ?? d.availability.days_per_week ?? 3

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 pb-0">
      <div className="flex items-center justify-between gap-2">
        {step > 0 ? (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setStep(step - 1)}>
            <ChevronLeft /> Atrás
          </Button>
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2"
          disabled={saving}
          onClick={() => void finish('all')}
        >
          Saltar todo <X />
        </Button>
      </div>

      <div>
        <p className="text-muted-foreground text-sm">
          Paso {step + 1} de {STEPS.length}
        </p>
        <div
          className="bg-muted mt-1 h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Progreso del onboarding"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <h1 className="mt-3 text-2xl font-bold">{STEPS[step]}</h1>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex flex-1 flex-col gap-5">
        {step === 0 && (
          <>
            <Section title="¿Qué quieres conseguir?" hint="Elige todos los que quieras.">
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => {
                  const on = d.goals.selected.includes(g)
                  return (
                    <Chip
                      key={g}
                      selected={on}
                      className="text-left"
                      onClick={() => {
                        const selected = on
                          ? d.goals.selected.filter((x) => x !== g)
                          : [...d.goals.selected, g]
                        const main =
                          d.goals.main && selected.includes(d.goals.main)
                            ? d.goals.main
                            : (selected[0] ?? null)
                        setData({ goals: { selected, main } })
                      }}
                    >
                      <span aria-hidden>{GOAL_LABELS[g].emoji} </span>
                      {GOAL_LABELS[g].label}
                    </Chip>
                  )
                })}
              </div>
            </Section>
            {d.goals.selected.length > 1 && (
              <Section
                title="¿Cuál es el principal?"
                hint="Con él elegimos el plan que te recomendamos."
              >
                <div className="flex flex-wrap gap-2">
                  {d.goals.selected.map((g: Goal) => (
                    <Chip
                      key={g}
                      selected={d.goals.main === g}
                      onClick={() => setData({ goals: { ...d.goals, main: g } })}
                    >
                      {GOAL_LABELS[g].label}
                    </Chip>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <Section title="Tu nivel">
              <div className="flex flex-col gap-2">
                {(Object.keys(LEVEL_LABELS) as TrainingLevel[]).map((level) => (
                  <Chip
                    key={level}
                    selected={d.level === level}
                    className="text-left"
                    onClick={() => setData({ level })}
                  >
                    <span className="block font-semibold">{LEVEL_LABELS[level].label}</span>
                    <span className="block text-xs opacity-80">{LEVEL_LABELS[level].hint}</span>
                  </Chip>
                ))}
              </div>
            </Section>
            <Section
              title="Marcas actuales"
              hint="Opcional y aproximado. Ayuda a ajustar pesos y ritmos."
            >
              <div className="grid grid-cols-3 gap-2">
                <Field
                  id="squat"
                  label="Sentadilla 1RM (kg)"
                  value={draft.squat}
                  onChange={(v) => set({ squat: v })}
                  decimal
                />
                <Field
                  id="bench"
                  label="Banca 1RM (kg)"
                  value={draft.bench}
                  onChange={(v) => set({ bench: v })}
                  decimal
                />
                <Field
                  id="deadlift"
                  label="Peso muerto 1RM (kg)"
                  value={draft.deadlift}
                  onChange={(v) => set({ deadlift: v })}
                  decimal
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field
                  id="run5k"
                  label="5K (mm:ss)"
                  placeholder="28:00"
                  value={draft.run5k}
                  onChange={(v) => set({ run5k: v })}
                />
                <Field
                  id="swim100"
                  label="100 m nado (m:ss)"
                  placeholder="2:10"
                  value={draft.swim100}
                  onChange={(v) => set({ swim100: v })}
                />
              </div>
            </Section>
            <Section title="Sobre ti" hint="Opcional.">
              <p className="mb-1 text-sm font-medium">Sexo</p>
              <p className="text-muted-foreground mb-2 text-xs">
                Solo para mostrarte los pesos de competición de HYROX y DEKA de tu categoría.
              </p>
              <div className="mb-3 grid grid-cols-3 gap-2" role="group" aria-label="Sexo">
                {SEX_OPTIONS.map((o) => (
                  <Chip
                    key={o.value}
                    selected={draft.sex === o.value}
                    onClick={() => set({ sex: draft.sex === o.value ? null : o.value })}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  id="birth"
                  label="Año de nacimiento"
                  value={draft.birthYear}
                  onChange={(v) => set({ birthYear: v })}
                  numeric
                />
                <Field
                  id="height"
                  label="Altura (cm)"
                  value={draft.heightCm}
                  onChange={(v) => set({ heightCm: v })}
                  numeric
                />
              </div>
            </Section>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="Días por semana para entrenar">
              <Stepper
                value={d.availability.days_per_week ?? 3}
                min={1}
                max={7}
                label="días"
                onChange={(v) => setData({ availability: { ...d.availability, days_per_week: v } })}
              />
            </Section>
            <Section title="Minutos por sesión">
              <div className="flex flex-wrap gap-2">
                {[30, 45, 60, 75, 90].map((m) => (
                  <Chip
                    key={m}
                    selected={d.availability.minutes_per_session === m}
                    onClick={() =>
                      setData({ availability: { ...d.availability, minutes_per_session: m } })
                    }
                  >
                    {m} min
                  </Chip>
                ))}
              </div>
            </Section>
            <Section
              title="Días preferidos"
              hint="El plan pondrá las sesiones en estos días siempre que pueda."
            >
              <WeekdayPicker
                label="Días preferidos"
                value={d.availability.preferred_days}
                onChange={(days) =>
                  setData({ availability: { ...d.availability, preferred_days: days } })
                }
              />
              {d.availability.preferred_days.length > 0 &&
                d.availability.days_per_week !== null &&
                d.availability.preferred_days.length !== d.availability.days_per_week && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    Has marcado {d.availability.preferred_days.length} días y quieres entrenar{' '}
                    {d.availability.days_per_week}.
                  </p>
                )}
            </Section>
          </>
        )}

        {step === 3 && (
          <>
            <Section title="¿Dónde entrenas?">
              <div className="flex flex-wrap gap-2">
                {TRAINING_PLACES.map((p) => {
                  const on = d.availability.places.includes(p)
                  return (
                    <Chip
                      key={p}
                      selected={on}
                      onClick={() =>
                        setData({
                          availability: {
                            ...d.availability,
                            places: on
                              ? d.availability.places.filter((x) => x !== p)
                              : [...d.availability.places, p],
                          },
                        })
                      }
                    >
                      {PLACE_LABELS[p]}
                    </Chip>
                  )
                })}
              </div>
            </Section>
            <Section
              title="Material disponible"
              hint="Se usa para proponer sustituciones de ejercicios."
            >
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_CHOICES.map((e) => {
                  const on = d.equipment.includes(e)
                  return (
                    <Chip
                      key={e}
                      selected={on}
                      onClick={() =>
                        setData({
                          equipment: on ? d.equipment.filter((x) => x !== e) : [...d.equipment, e],
                        })
                      }
                    >
                      {EQUIPMENT_LABELS[e] ?? e}
                    </Chip>
                  )
                })}
              </div>
            </Section>
            <Section
              title="Lesiones o molestias"
              hint="Opcional. Texto libre; el plan será prudente con ellas."
            >
              <Textarea
                aria-label="Lesiones o molestias"
                rows={3}
                maxLength={500}
                value={d.limitations ?? ''}
                placeholder="P. ej.: molestia en el hombro derecho al press por encima de la cabeza"
                onChange={(e) => setData({ limitations: e.target.value })}
              />
            </Section>
          </>
        )}

        {step === 4 && (
          <Section
            title="¿Haces alguna actividad fija?"
            hint="Cuentan como carga y el plan las respeta: no pone pierna pesada el día antes de frontón o surf."
          >
            <div className="flex flex-col gap-3">
              {FIXED_TYPES.map((type) => (
                <FixedActivityRow
                  key={type}
                  type={type}
                  value={d.fixedActivities.find((f) => f.type === type) ?? null}
                  onChange={(value) =>
                    setData({
                      fixedActivities: [
                        ...d.fixedActivities.filter((f) => f.type !== type),
                        ...(value ? [value] : []),
                      ],
                    })
                  }
                />
              ))}
            </div>
          </Section>
        )}

        {step === 5 && (
          <>
            <Section
              title="Tu compromiso"
              hint="Sesiones por semana que te comprometes a hacer. Tu pareja o amigos vinculados verán el cumplimiento."
            >
              {current && (
                <p className="mb-2 text-sm">
                  Ahora tienes <strong>{current.sessionsPerWeek}</strong> sesiones por semana.
                </p>
              )}
              <Stepper
                value={sessions}
                min={1}
                max={14}
                label="sesiones"
                onChange={(v) => set({ sessions: v, updateCommitment: true })}
              />
              {current && sessions !== current.sessionsPerWeek && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={draft.updateCommitment}
                    onChange={(e) => set({ updateCommitment: e.target.checked })}
                  />
                  Cambiar mi compromiso a {sessions} desde esta semana
                </label>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                Minutos y reparto por tipo: en Perfil → Mi compromiso.
              </p>
            </Section>
            <Section
              title="Ciudad de referencia"
              hint="Para las equivalencias de distancia («como ir de tu ciudad a Valencia»). No usamos tu ubicación."
            >
              {draft.home && (
                <p className="mb-2 flex items-center gap-2 text-sm">
                  <MapPin className="text-primary size-4" /> <strong>{draft.home.city}</strong>
                </p>
              )}
              <CitySearch
                selected={draft.home?.city ?? null}
                maxHeight="max-h-56"
                manualHint="podrás escribir las coordenadas en Perfil → Ciudad de referencia"
                onPick={(home) => set({ home })}
              />
            </Section>
          </>
        )}
      </div>

      <div
        className="bg-background sticky bottom-0 grid grid-cols-2 gap-2 py-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Button
          variant="outline"
          size="lg"
          disabled={saving}
          onClick={() => (last ? void finish('partial') : setStep(step + 1))}
        >
          {last ? 'Saltar' : 'Saltar paso'}
        </Button>
        <Button
          size="lg"
          disabled={saving}
          onClick={() => (last ? void finish() : setStep(step + 1))}
        >
          {last ? (saving ? 'Guardando…' : 'Terminar') : 'Siguiente'}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-muted-foreground mb-2 text-sm">{hint}</p>}
      <div className={cn(!hint && 'mt-2')}>{children}</div>
    </section>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  decimal,
  numeric,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  decimal?: boolean
  numeric?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs leading-tight">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={decimal ? 'decimal' : numeric ? 'numeric' : 'text'}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function FixedActivityRow({
  type,
  value,
  onChange,
}: {
  type: FixedType
  value: FixedActivity | null
  onChange: (value: FixedActivity | null) => void
}) {
  const [days, setDays] = useState<number[]>(value?.days ?? [])
  const [minutes, setMinutes] = useState(value?.minutes ? String(value.minutes) : '')
  const emit = (nextDays: number[], nextMinutes: string) => {
    const m = parseInteger(nextMinutes)
    onChange(
      nextDays.length > 0
        ? { type, days: nextDays, minutes: m && m >= 5 && m <= 600 ? m : null, label: null }
        : null,
    )
  }
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 font-medium">{FIXED_LABELS[type]}</p>
      <WeekdayPicker
        label={`Días de ${FIXED_LABELS[type]}`}
        value={days}
        onChange={(next) => {
          setDays(next)
          emit(next, minutes)
        }}
      />
      {days.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Label htmlFor={`fixed-${type}`} className="text-sm">
            Minutos
          </Label>
          <Input
            id={`fixed-${type}`}
            inputMode="numeric"
            className="w-24"
            placeholder="90"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value)
              emit(days, e.target.value)
            }}
          />
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Dumbbell, History, Users, Zap } from 'lucide-react'
import { PartnerPickerSheet, useAcceptedPartners, usePairStart } from '@/components/partners/pair'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { quickActivityOptions } from '@/lib/activities/catalog'
import { useActivityTypes } from '@/lib/activities/hooks'
import type { PartnerLink } from '@/lib/progress/api'
import { startNewSession, type SessionStart } from '@/lib/workout/active-session'
import { localDateKey, addDays } from '@/lib/progress/dates'
import {
  defaultTime,
  startHint,
  startKind,
  whenFromInstant,
  whenProblem,
  whenToMs,
  type WhenValue,
} from '@/lib/workout/when'
import { WhenField } from './when-field'
import { useNow } from '@/lib/workout/hooks'
import { START_OPTIONS, sessionTypeEmoji } from '@/lib/workout/session-kinds'
import { QuickStartOptions } from './templates'
import type { SessionType } from '@/types/database'

// Botones de inicio: «Empezar entreno» (elige tipo), «Registrar actividad» y, si hay personas
// vinculadas, «Entrenar con…» (entreno en pareja, §7). Con `showPast`, también «Registrar
// entreno pasado» (sin temporizadores, con la fecha elegida).
export function StartSessionButtons({
  userId,
  label = 'Empezar entreno',
  showPast = false,
}: {
  userId: string
  label?: string
  showPast?: boolean
}) {
  const navigate = useNavigate()
  const [choosing, setChoosing] = useState(false)
  // «Registrar entreno pasado»: la misma hoja, con la fecha de ayer por defecto.
  const [past, setPast] = useState(false)
  const [when, setWhen] = useState<WhenValue>(() => whenFromInstant(Date.now()))
  const nowMs = useNow(30_000)
  const partners = useAcceptedPartners(userId)
  const pair = usePairStart(userId)
  const [picking, setPicking] = useState(false)
  const [partner, setPartner] = useState<PartnerLink | null>(null)
  useActivityTypes(userId)

  // Fecha y hora elegidas → cómo empieza (null si no valen: futuro o incompleta).
  function chosenStart(now: number): SessionStart | null {
    if (whenProblem(when, now)) return null
    const ms = whenToMs(when)!
    const kind = startKind(ms, now)
    return past ? { kind: 'past', startedAt: ms } : kind
  }

  function openSheet(asPast: boolean) {
    const now = Date.now()
    setPast(asPast)
    setWhen(
      asPast
        ? { date: addDays(localDateKey(now), -1), time: defaultTime(now) }
        : whenFromInstant(now),
    )
    setChoosing(true)
  }

  async function start(type: SessionType) {
    if (partner) {
      setChoosing(false)
      await pair.startFree(type, partner)
      setPartner(null)
      return
    }
    const at = chosenStart(nowMs)
    if (!at) return
    setChoosing(false)
    await startNewSession(userId, type, at)
    await navigate({ to: '/entrenar/sesion' })
  }

  const current = chosenStart(nowMs)
  const hint = current && !past ? startHint(current, nowMs) : null

  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button size="lg" className="h-16 text-lg" onClick={() => openSheet(false)}>
          <Dumbbell className="size-6" /> {label}
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 px-4">
          <Link to="/entrenar/actividad" aria-label="Registrar actividad">
            <Zap className="size-5" /> Actividad
          </Link>
        </Button>
      </div>
      {partners.length > 0 && (
        <Button
          variant="outline"
          size="lg"
          disabled={pair.busy}
          onClick={() => setPicking(true)}
          className="-mt-1"
        >
          <Users /> Entrenar con…
        </Button>
      )}
      {showPast && (
        <Button variant="outline" size="lg" onClick={() => openSheet(true)} className="-mt-1">
          <History /> Registrar entreno pasado
        </Button>
      )}
      <PartnerPickerSheet
        open={picking}
        partners={partners}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          setPartner(p)
          openSheet(false)
        }}
      />
      <Sheet
        open={choosing}
        onClose={() => {
          setChoosing(false)
          setPartner(null)
        }}
        title={
          partner
            ? `¿Qué entrenáis ${partner.displayName} y tú?`
            : past
              ? 'Registrar entreno pasado'
              : '¿Qué vas a entrenar?'
        }
      >
        {!partner && (
          <div className="pb-4">
            <WhenField
              label={past ? '¿Cuándo lo hiciste?' : '¿Cuándo?'}
              value={when}
              onChange={setWhen}
              now={nowMs}
              hint={
                past
                  ? 'Apuntas ejercicios, series, pesos y duración, sin temporizadores ni cuenta en vivo.'
                  : hint
              }
            />
          </div>
        )}
        {!partner && (
          <QuickStartOptions
            userId={userId}
            onStarted={() => setChoosing(false)}
            start={() => chosenStart(nowMs)}
            past={past}
          />
        )}
        <div className="grid grid-cols-2 gap-2 pb-2">
          {START_OPTIONS.map((o) => (
            <button
              key={o.sessionType}
              type="button"
              disabled={!partner && !current}
              onClick={() => void start(o.sessionType)}
              className="bg-secondary flex h-24 flex-col items-center justify-center gap-1 rounded-2xl text-lg font-bold active:scale-95 disabled:opacity-50"
            >
              <span className="text-3xl" aria-hidden>
                {sessionTypeEmoji(o.sessionType)}
              </span>
              {o.label}
            </button>
          ))}
        </div>
        {partner ? (
          <>
            <p className="text-muted-foreground pb-2 text-center text-sm">
              Añade los ejercicios en la sesión y envíale la estructura desde allí.
            </p>
            <h3 className="pb-2 text-sm font-semibold">Deporte, clase o actividad</h3>
            <div className="grid grid-cols-3 gap-2 pb-3">
              {quickActivityOptions(userId).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setChoosing(false)
                    void pair.startActivity(a.id, partner).then(() => setPartner(null))
                  }}
                  className="bg-secondary flex h-20 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-sm font-semibold active:scale-95"
                >
                  <span className="text-2xl" aria-hidden>
                    {a.emoji}
                  </span>
                  <span className="line-clamp-1">{a.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        <p className="text-muted-foreground pb-2 text-center text-sm">
          ¿Deporte, clase o yoga?{' '}
          <Link
            to="/entrenar/actividad"
            search={past && current?.kind !== 'now' && current ? { desde: current.startedAt } : {}}
            className="text-primary underline"
          >
            Registrar actividad
          </Link>
        </p>
      </Sheet>
    </>
  )
}

import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Dumbbell, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { startNewSession } from '@/lib/workout/active-session'
import { START_OPTIONS, sessionTypeEmoji } from '@/lib/workout/session-kinds'
import type { SessionType } from '@/types/database'

// Botones de inicio: «Empezar entreno» (elige tipo) y «Registrar actividad».
export function StartSessionButtons({ userId, label = 'Empezar entreno' }: { userId: string; label?: string }) {
  const navigate = useNavigate()
  const [choosing, setChoosing] = useState(false)

  async function start(type: SessionType) {
    setChoosing(false)
    await startNewSession(userId, type)
    await navigate({ to: '/entrenar/sesion' })
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button size="lg" className="h-16 text-lg" onClick={() => setChoosing(true)}>
          <Dumbbell className="size-6" /> {label}
        </Button>
        <Button asChild size="lg" variant="outline" className="h-16 px-4">
          <Link to="/entrenar/actividad" aria-label="Registrar actividad">
            <Zap className="size-5" /> Actividad
          </Link>
        </Button>
      </div>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="¿Qué vas a entrenar?">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {START_OPTIONS.map((o) => (
            <button
              key={o.sessionType}
              type="button"
              onClick={() => void start(o.sessionType)}
              className="bg-secondary flex h-24 flex-col items-center justify-center gap-1 rounded-2xl text-lg font-bold active:scale-95"
            >
              <span className="text-3xl" aria-hidden>
                {sessionTypeEmoji(o.sessionType)}
              </span>
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground pb-2 text-center text-sm">
          ¿Surf, frontón o yoga?{' '}
          <Link to="/entrenar/actividad" className="text-primary underline">
            Registrar actividad
          </Link>
        </p>
      </Sheet>
    </>
  )
}

import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { z } from 'zod'
import { BackLink } from '@/components/progress/common'
import { homeOf } from '@/components/progress/achievements'
import { CitySearch } from '@/components/progress/city-search'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetAuthState } from '@/lib/auth'
import { notifyError, notifySaved } from '@/lib/notify'
import { updateProfileSettings } from '@/lib/progress/api'
import type { Home } from '@/lib/progress/equivalences'

export const Route = createFileRoute('/_app/perfil/ciudad')({
  ssr: false,
  validateSearch: z.object({ volver: z.enum(['logros']).optional() }),
  component: HomeCityPage,
})

// «40,4168» o «40.4168» → número dentro del rango.
function parseCoord(input: string, max: number) {
  const v = Number(input.trim().replace(',', '.'))
  return input.trim() !== '' && Number.isFinite(v) && Math.abs(v) <= max ? v : null
}

function HomeCityPage() {
  const { auth } = Route.useRouteContext()
  const { volver } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const current = homeOf(auth.profile)
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(home: Home | null) {
    setSaving(true)
    setStatus(null)
    try {
      await updateProfileSettings(auth.userId, { home })
      await resetAuthState(queryClient)
      await router.invalidate()
      notifySaved(home ? `Ciudad de referencia: ${home.city}` : 'Ciudad de referencia quitada')
      await navigate({ to: volver === 'logros' ? '/progreso/logros' : '/perfil' })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo guardar')
      notifyError(error, 'guardar la ciudad')
    } finally {
      setSaving(false)
    }
  }

  function saveManual(e: FormEvent) {
    e.preventDefault()
    const la = parseCoord(lat, 90)
    const ln = parseCoord(lng, 180)
    if (!name.trim() || la === null || ln === null) {
      setStatus('Escribe un nombre, una latitud (−90 a 90) y una longitud (−180 a 180).')
      notifyError('faltan el nombre o unas coordenadas válidas', 'guardar la ciudad')
      return
    }
    void save({ city: name.trim().slice(0, 60), lat: la, lng: ln })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink
        to={volver === 'logros' ? '/progreso/logros' : '/perfil'}
        label={volver === 'logros' ? 'Mis logros' : 'Perfil'}
      />
      <h1 className="text-2xl font-bold">Ciudad de referencia</h1>
      <p className="text-muted-foreground text-sm">
        Desde aquí medimos tus equivalencias de distancia («como ir de tu ciudad a Valencia»),
        siempre en línea recta. No usamos tu ubicación.
      </p>
      {current && (
        <p className="flex items-center gap-2 text-sm">
          <MapPin className="text-primary size-4" /> Ahora: <strong>{current.city}</strong>
        </p>
      )}
      {status && <p className="text-destructive text-sm">{status}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
        </CardHeader>
        <CardContent>
          <CitySearch
            selected={current?.city ?? null}
            disabled={saving}
            onPick={(home) => void save(home)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>A mano</CardTitle>
          <CardDescription>
            Busca las coordenadas de tu ciudad (p. ej. en un mapa) y escríbelas en grados decimales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveManual} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city_name">Nombre</Label>
              <Input
                id="city_name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="city_lat">Latitud</Label>
                <Input
                  id="city_lat"
                  inputMode="decimal"
                  placeholder="40,4168"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="city_lng">Longitud</Label>
                <Input
                  id="city_lng"
                  inputMode="decimal"
                  placeholder="-3,7038"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" size="lg" disabled={saving}>
              Guardar
            </Button>
          </form>
        </CardContent>
      </Card>

      {current && (
        <Button variant="ghost" disabled={saving} onClick={() => void save(null)}>
          Quitar ciudad de referencia
        </Button>
      )}
    </div>
  )
}

import { useMemo, useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, Search } from 'lucide-react'
import { z } from 'zod'
import { BackLink } from '@/components/progress/common'
import { homeOf } from '@/components/progress/achievements'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetAuthState } from '@/lib/auth'
import { updateProfileSettings } from '@/lib/progress/api'
import type { Home } from '@/lib/progress/equivalences'
import { useEquivalenceCatalog } from '@/lib/progress/hooks'
import { normalizeText as normalize } from '@/lib/workout/search'

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
  const catalog = useEquivalenceCatalog()
  const current = homeOf(auth.profile)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const results = useMemo(() => {
    const q = normalize(query)
    return (catalog.data?.destinations ?? [])
      .filter((d) => !q || normalize(d.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .slice(0, q ? 20 : 60)
  }, [catalog.data, query])

  async function save(home: Home | null) {
    setSaving(true)
    setStatus(null)
    try {
      await updateProfileSettings(auth.userId, { home })
      await resetAuthState(queryClient)
      await router.invalidate()
      await navigate({ to: volver === 'logros' ? '/progreso/logros' : '/perfil' })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo guardar')
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
        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Madrid, Palma, Lisboa…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar ciudad"
            />
          </div>
          {catalog.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
          {catalog.isError && (
            <p className="text-muted-foreground text-sm">
              No se ha podido cargar la lista. Puedes introducir las coordenadas a mano.
            </p>
          )}
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {results.map((d) => {
              const selected = current?.city === d.name
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save({ city: d.name, lat: d.lat, lng: d.lng })}
                    className="hover:bg-accent flex w-full items-center justify-between rounded-lg px-2 py-3 text-left"
                  >
                    <span>{d.name}</span>
                    {selected && <Check className="text-primary size-4" />}
                  </button>
                </li>
              )
            })}
            {catalog.data && results.length === 0 && (
              <li className="text-muted-foreground px-2 py-3 text-sm">
                No está en la lista: introdúcela a mano abajo.
              </li>
            )}
          </ul>
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

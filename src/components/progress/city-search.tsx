import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { Home } from '@/lib/progress/equivalences'
import { useEquivalenceCatalog } from '@/lib/progress/hooks'
import { normalizeText as normalize } from '@/lib/workout/search'

// Buscador de la ciudad de referencia sobre el catálogo de destinos (sin geolocalización).
export function CitySearch({
  selected,
  disabled = false,
  onPick,
  maxHeight = 'max-h-80',
  manualHint = 'introdúcela a mano abajo',
}: {
  selected: string | null
  disabled?: boolean
  onPick: (home: Home) => void
  maxHeight?: string
  // Dónde se pueden escribir las coordenadas a mano.
  manualHint?: string
}) {
  const catalog = useEquivalenceCatalog()
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const q = normalize(query)
    return (catalog.data?.destinations ?? [])
      .filter((d) => !q || normalize(d.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .slice(0, q ? 20 : 60)
  }, [catalog.data, query])

  return (
    <div className="flex flex-col gap-3">
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
          No se ha podido cargar la lista: {manualHint}.
        </p>
      )}
      <ul className={`flex ${maxHeight} flex-col overflow-y-auto`}>
        {results.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick({ city: d.name, lat: d.lat, lng: d.lng })}
              className="hover:bg-accent flex w-full items-center justify-between rounded-lg px-2 py-3 text-left"
            >
              <span>{d.name}</span>
              {selected === d.name && <Check className="text-primary size-4" />}
            </button>
          </li>
        ))}
        {catalog.data && results.length === 0 && (
          <li className="text-muted-foreground px-2 py-3 text-sm">
            No está en la lista: {manualHint}.
          </li>
        )}
      </ul>
    </div>
  )
}

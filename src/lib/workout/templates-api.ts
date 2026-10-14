// «Repetir entreno» y «Mis plantillas»: datos (Supabase + copia en IndexedDB para usarlas sin
// conexión) y el arranque de la sesión con los pesos sugeridos.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { idbGet, idbPut } from '@/lib/offline/idb'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import type { Json, SessionType, WorkoutTemplateRow } from '@/types/database'
import { getLocalSession, startPreparedSession } from './active-session'
import {
  fetchSession,
  getExerciseHistory,
  getLastPerformance,
  isOnline,
  OfflineError,
  withTimeout,
} from './api'
import { useCatalog } from './hooks'
import {
  parseStructure,
  sessionFromStructure,
  structureExerciseIds,
  structureFromSession,
  type WorkoutStructure,
  type WorkoutTemplate,
} from './templates'
import type { Exercise, LastPerformance, LocalSession } from './types'

const db = () => getSupabaseBrowserClient()
const cacheKey = (userId: string) => `templates:${userId}`
export const templatesQueryKey = (userId: string) => ['workout-templates', userId] as const

function toTemplate(row: WorkoutTemplateRow): WorkoutTemplate | null {
  const structure = parseStructure(row.structure)
  if (!structure) return null
  return {
    id: row.id,
    name: row.name,
    sessionType: row.session_type,
    activityTypeId: row.activity_type_id,
    structure,
    lastUsedAt: row.last_used_at,
    updatedAt: row.updated_at,
  }
}

// Más usadas primero (las recién creadas, arriba).
function sortTemplates(list: WorkoutTemplate[]) {
  return [...list].sort((a, b) =>
    (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt),
  )
}

export async function fetchTemplates(userId: string): Promise<WorkoutTemplate[]> {
  if (isOnline()) {
    try {
      const { data, error } = await withTimeout(
        db().from('workout_templates').select('*').eq('user_id', userId),
      )
      if (error) throw new Error(error.message)
      const list = sortTemplates(
        (data ?? []).flatMap((r) => {
          const t = toTemplate(r)
          return t ? [t] : []
        }),
      )
      await idbPut('kv', cacheKey(userId), list)
      return list
    } catch (error) {
      console.error('[templates] usando la copia local', error)
    }
  }
  return (await idbGet<WorkoutTemplate[]>('kv', cacheKey(userId))) ?? []
}

export function useTemplates(userId: string) {
  return useQuery({
    queryKey: templatesQueryKey(userId),
    queryFn: () => fetchTemplates(userId),
    staleTime: 60_000,
    networkMode: 'always',
  })
}

export async function createTemplate(input: {
  name: string
  sessionType: SessionType
  activityTypeId: string | null
  structure: WorkoutStructure
}) {
  if (!isOnline()) throw new OfflineError()
  const { data, error } = await withTimeout(
    db()
      .from('workout_templates')
      .insert({
        name: input.name.trim().slice(0, 80),
        session_type: input.sessionType,
        activity_type_id: input.sessionType === 'custom' ? input.activityTypeId : null,
        structure: input.structure as unknown as Json,
      })
      .select('*')
      .single(),
  )
  if (error) throw new Error(error.message)
  return toTemplate(data)
}

export async function renameTemplate(id: string, name: string) {
  const { data, error } = await withTimeout(
    db()
      .from('workout_templates')
      .update({ name: name.trim().slice(0, 80), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
  )
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('no se ha encontrado la plantilla')
}

export async function deleteTemplate(id: string) {
  const { error } = await withTimeout(db().from('workout_templates').delete().eq('id', id))
  if (error) throw new Error(error.message)
}

// Marca la plantilla como usada (para ordenarlas). Sin conexión no pasa nada.
async function touchTemplate(id: string) {
  if (!isOnline()) return
  try {
    await withTimeout(
      db()
        .from('workout_templates')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', id),
    )
  } catch (error) {
    console.error('[templates] last_used_at', error)
  }
}

export function useTemplateMutations(userId: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: templatesQueryKey(userId) })
  const create = useMutation({
    mutationFn: createTemplate,
    onSuccess: async (t) => {
      notifySaved(`Plantilla «${t?.name ?? ''}» guardada`)
      await refresh()
    },
    onError: (e) => notifyError(e, 'guardar la plantilla'),
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTemplate(id, name),
    onSuccess: async () => {
      notifySaved('Plantilla renombrada')
      await refresh()
    },
    onError: (e) => notifyError(e, 'renombrar la plantilla'),
  })
  const remove = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: async () => {
      notifySaved('Plantilla borrada')
      await refresh()
    },
    onError: (e) => notifyError(e, 'borrar la plantilla'),
  })
  return { create, rename, remove }
}

// Sesión terminada para repetirla: la copia del móvil si la hay; si no, el servidor.
export async function loadSessionForRepeat(sessionId: string): Promise<LocalSession | null> {
  const local = await getLocalSession(sessionId)
  if (local) return local
  return fetchSession(sessionId)
}

export async function prepareFromStructure(
  structure: WorkoutStructure,
  opts: {
    userId: string
    title: string
    sessionType: SessionType
    activityTypeId?: string | null
    catalog: Map<string, Exercise>
  },
): Promise<LocalSession> {
  const ids = structureExerciseIds(structure)
  let last = new Map<string, LastPerformance>()
  let history = new Map<string, LastPerformance[]>()
  try {
    ;[last, history] = await Promise.all([
      getLastPerformance(opts.userId, ids, null),
      getExerciseHistory(opts.userId, ids, null),
    ])
  } catch {
    // sin conexión ni copia: sin precarga de pesos
  }
  return sessionFromStructure(structure, { ...opts, last, history })
}

// Arranque común de «Repetir» y de una plantilla: prepara la sesión y abre la sesión en curso.
export function useStartFromStructure(userId: string) {
  const navigate = useNavigate()
  const catalog = useCatalog(userId)
  const [busy, setBusy] = useState(false)

  async function start(
    structure: WorkoutStructure,
    meta: {
      title: string
      sessionType: SessionType
      activityTypeId?: string | null
      templateId?: string
    },
  ) {
    setBusy(true)
    try {
      const session = await prepareFromStructure(structure, {
        userId,
        catalog: catalog.byId,
        title: meta.title,
        sessionType: meta.sessionType,
        activityTypeId: meta.activityTypeId ?? null,
      })
      if (session.blocks.length === 0) {
        notifyWarning('Sus ejercicios ya no están en tu biblioteca')
        return
      }
      const { started } = await startPreparedSession(session)
      if (!started)
        notifyError('ya tienes una sesión en curso; termínala o descártala antes', 'empezar')
      else if (meta.templateId) void touchTemplate(meta.templateId)
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'empezar la sesión')
    } finally {
      setBusy(false)
    }
  }

  // «Repetir»: la misma estructura que una sesión pasada (por id o ya cargada).
  async function repeat(source: string | LocalSession) {
    setBusy(true)
    let session: LocalSession | null
    try {
      session = typeof source === 'string' ? await loadSessionForRepeat(source) : source
    } catch (error) {
      setBusy(false)
      notifyError(error, 'leer la sesión')
      return
    }
    setBusy(false)
    const structure = session ? structureFromSession(session) : null
    if (!session || !structure) {
      notifyWarning('Esa sesión no tiene ejercicios que repetir')
      return
    }
    await start(structure, {
      title: session.title || 'Entreno',
      sessionType: session.sessionType,
      activityTypeId: session.activityTypeId ?? null,
    })
  }

  return { start, repeat, busy: busy || catalog.isPending }
}

// Sesión en curso: vive en memoria + IndexedDB y se encola para el servidor en cada cambio.
// Así nunca se pierde aunque se cierre la app o se vaya la conexión.
import { useSyncExternalStore } from 'react'
import { idbDelete, idbGet, idbGetAll, idbPut } from '@/lib/offline/idb'
import { enqueueDelete, enqueueSave, listOutbox } from '@/lib/offline/outbox'
import { requestSync } from '@/lib/offline/sync-engine'
import { rememberLastPerformance } from './api'
import { toPayload } from './payload'
import { finishSession, type SessionDetailsPatch } from './session-ops'
import { createSessionOfType } from './session-kinds'
import type { LocalSession } from './types'
import type { SessionType } from '@/types/database'

type State = { loadedFor: string | null; session: LocalSession | null }

let state: State = { loadedFor: null, session: null }
const listeners = new Set<() => void>()
let writeChain: Promise<void> = Promise.resolve()

const activeKey = (userId: string) => `active:${userId}`

function emit() {
  for (const l of listeners) l()
}

function setState(next: State) {
  state = next
  emit()
}

// Las escrituras se encadenan para que lleguen a IndexedDB en orden.
function persist(task: () => Promise<void>) {
  writeChain = writeChain.then(task).catch((error: unknown) => {
    console.error('[active-session] error guardando en el dispositivo', error)
  })
  return writeChain
}

async function saveLocal(session: LocalSession, enqueue: boolean) {
  await idbPut('sessions', session.id, session)
  if (enqueue) {
    await enqueueSave(session.id, session.userId, session.rev, toPayload(session))
    requestSync()
  }
}

export async function loadActiveSession(userId: string) {
  if (state.loadedFor === userId) return state.session
  const id = await idbGet<string>('kv', activeKey(userId))
  const session = id ? ((await idbGet<LocalSession>('sessions', id)) ?? null) : null
  setState({ loadedFor: userId, session: session && !session.endedAt ? session : null })
  return state.session
}

export function getActiveSession() {
  return state.session
}

export async function startNewSession(userId: string, sessionType: SessionType = 'strength') {
  await loadActiveSession(userId)
  if (state.session) return state.session
  const session = createSessionOfType(userId, sessionType, Date.now())
  setState({ loadedFor: userId, session })
  await persist(async () => {
    await idbPut('kv', activeKey(userId), session.id)
    await saveLocal(session, true)
  })
  return session
}

// Empieza una sesión ya preparada (p. ej. desde el plan). Si ya hay una en curso, la devuelve
// sin tocarla (quien llama decide qué hacer).
export async function startPreparedSession(session: LocalSession) {
  await loadActiveSession(session.userId)
  if (state.session) return { session: state.session, started: false }
  setState({ loadedFor: session.userId, session })
  await persist(async () => {
    await idbPut('kv', activeKey(session.userId), session.id)
    await saveLocal(session, true)
  })
  return { session, started: true }
}

// Guarda una sesión ya terminada (p. ej. «Registrar actividad») sin pasar por la sesión en curso.
export async function saveFinishedSession(session: LocalSession) {
  await persist(() => saveLocal(session, true))
  return session
}

// Aplica un cambio. Solo se encola para el servidor si cambia `rev`
// (pausar el descanso, por ejemplo, solo se guarda en el dispositivo).
export function updateActiveSession(fn: (session: LocalSession) => LocalSession) {
  const current = state.session
  if (!current) return
  const next = fn(current)
  if (next === current) return
  setState({ ...state, session: next })
  void persist(() => saveLocal(next, next.rev !== current.rev))
}

export async function finishActiveSession(details: SessionDetailsPatch) {
  const current = state.session
  if (!current) return null
  const finished = finishSession(current, details, Date.now())
  setState({ ...state, session: null })
  await persist(async () => {
    await idbDelete('kv', activeKey(finished.userId))
    await saveLocal(finished, true)
    await rememberLastPerformance(finished)
  })
  return finished
}

// Descarta la sesión en curso (y la borra del servidor si llegó a subirse).
export async function discardActiveSession() {
  const current = state.session
  if (!current) return
  setState({ ...state, session: null })
  await persist(async () => {
    await idbDelete('kv', activeKey(current.userId))
    await idbDelete('sessions', current.id)
    await enqueueDelete(current.id, current.userId)
    requestSync()
  })
}

// Abre una sesión ya terminada para editarla con la misma pantalla.
export async function editSession(session: LocalSession) {
  await loadActiveSession(session.userId)
  if (state.session && state.session.id !== session.id) {
    throw new Error('Termina o descarta primero la sesión en curso')
  }
  const editable: LocalSession = { ...session, mode: 'edit', rest: null }
  setState({ loadedFor: session.userId, session: editable })
  await persist(async () => {
    await idbPut('kv', activeKey(session.userId), editable.id)
    await idbPut('sessions', editable.id, editable)
  })
}

// En modo edición, «Guardar» cierra la edición y encola la versión final.
export async function saveEditedSession(details: SessionDetailsPatch) {
  const current = state.session
  if (!current) return null
  const saved: LocalSession = {
    ...current,
    ...details,
    mode: 'live',
    rest: null,
    rev: Math.max(current.rev + 1, Date.now()),
  }
  setState({ ...state, session: null })
  await persist(async () => {
    await idbDelete('kv', activeKey(saved.userId))
    await saveLocal(saved, true)
  })
  return saved
}

export async function cancelEdit() {
  const current = state.session
  if (!current || current.mode !== 'edit') return
  setState({ ...state, session: null })
  await persist(async () => {
    await idbDelete('kv', activeKey(current.userId))
    // La copia local se descarta: la buena es la del servidor (o la pendiente en la cola).
    const pending = (await listOutbox(current.userId)).some((i) => i.sessionId === current.id)
    if (!pending) await idbDelete('sessions', current.id)
  })
}

export async function deleteSession(sessionId: string, userId: string) {
  await persist(async () => {
    await idbDelete('sessions', sessionId)
    await enqueueDelete(sessionId, userId)
    requestSync()
  })
}

// Sesiones terminadas guardadas en el dispositivo (para verlas aunque no haya conexión).
export async function getLocalSession(sessionId: string) {
  return (await idbGet<LocalSession>('sessions', sessionId)) ?? null
}

export async function listLocalFinishedSessions(userId: string) {
  const all = await idbGetAll<LocalSession>('sessions')
  return all.filter((s) => s.userId === userId && s.endedAt)
}

// Limpia copias locales antiguas ya sincronizadas (se conservan 14 días para verlas offline).
export async function pruneLocalSessions(userId: string, now = Date.now()) {
  const pending = new Set((await listOutbox(userId)).map((i) => i.sessionId))
  const activeId = await idbGet<string>('kv', activeKey(userId))
  for (const s of await idbGetAll<LocalSession>('sessions')) {
    if (s.userId !== userId || s.id === activeId || pending.has(s.id) || !s.endedAt) continue
    if (now - new Date(s.endedAt).getTime() > 14 * 24 * 3600 * 1000) {
      await idbDelete('sessions', s.id)
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useActiveSession() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

// Solo para tests.
export function __resetActiveSessionForTests() {
  state = { loadedFor: null, session: null }
  writeChain = Promise.resolve()
}

export function __waitForWrites() {
  return writeChain
}

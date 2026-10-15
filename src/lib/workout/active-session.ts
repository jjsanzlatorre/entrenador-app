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
import { retimeSession, type StartKind } from './when'
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

// Cuándo empieza: ahora (por defecto), hace un rato hoy (en directo con esa hora de inicio) o
// antes (modo «entreno pasado»). Ver startKind en ./when.
export type SessionStart = StartKind

export function applyStart(session: LocalSession, start: SessionStart | undefined): LocalSession {
  if (!start || start.kind === 'now') return session
  if (start.kind === 'past') return asPastSession(session, start.startedAt)
  return { ...session, startedAt: new Date(start.startedAt).toISOString() }
}

export async function startNewSession(
  userId: string,
  sessionType: SessionType = 'strength',
  start?: SessionStart,
) {
  await loadActiveSession(userId)
  if (state.session) return state.session
  const session = applyStart(createSessionOfType(userId, sessionType, Date.now()), start)
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

// «Registrar entreno pasado»: la sesión preparada (vacía, de una plantilla, de «Repetir» o del
// plan) se abre sin temporizadores ni cuenta en vivo, con la fecha y hora elegidas.
export function asPastSession(session: LocalSession, startedAt: number): LocalSession {
  return {
    ...session,
    mode: 'past',
    startedAt: new Date(startedAt).toISOString(),
    rest: null,
    // Los bloques con temporizador no se cronometran: sus series se apuntan a mano.
    blocks: session.blocks.map((b) => (b.timer ? { ...b, timer: null } : b)),
  }
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
  const now = Date.now()
  const { startedAt, ...rest } = details
  const patched: LocalSession = { ...current, ...rest }
  const retimed =
    startedAt && startedAt !== current.startedAt
      ? retimeSession(patched, startedAt, patched.durationMin, now)
      : patched
  const saved: LocalSession = {
    ...retimed,
    mode: 'live',
    rest: null,
    rev: Math.max(current.rev + 1, retimed.rev, now),
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

// Cambia la fecha y hora de una sesión ya registrada (historial). Se guarda en el móvil y se
// encola con la nueva fecha: el servidor rehace récords y la planificada enlazada sigue igual.
export async function rescheduleSession(session: LocalSession, startedAt: string) {
  const moved: LocalSession = {
    ...retimeSession({ ...session, mode: 'edit' }, startedAt, session.durationMin, Date.now()),
    mode: 'live',
  }
  await persist(() => saveLocal(moved, true))
  return moved
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

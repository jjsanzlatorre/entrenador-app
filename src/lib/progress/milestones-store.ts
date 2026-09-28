// Hitos ya enseñados (milestones_shown) con copia en el dispositivo: el pop-up de fin de
// sesión funciona sin conexión y las marcas pendientes se suben en cuanto hay red.
import { idbDelete, idbGet, idbPut } from '@/lib/offline/idb'
import { fetchShownMilestones, insertShownMilestones, type ShownMilestone } from './api'

const cacheKey = (userId: string) => `milestones:${userId}`
const pendingKey = (userId: string) => `milestones-pending:${userId}`

function merge(...lists: ShownMilestone[][]) {
  const byKey = new Map<string, ShownMilestone>()
  for (const item of lists.flat()) if (!byKey.has(item.key)) byKey.set(item.key, item)
  return [...byKey.values()].sort((a, b) => b.shownAt.localeCompare(a.shownAt))
}

async function flushPending(userId: string) {
  const pending = (await idbGet<ShownMilestone[]>('kv', pendingKey(userId))) ?? []
  if (pending.length === 0) return
  await insertShownMilestones(userId, pending)
  // Solo se borran las que se han subido (puede haber llegado otra mientras tanto).
  const now = (await idbGet<ShownMilestone[]>('kv', pendingKey(userId))) ?? []
  const sent = new Set(pending.map((p) => p.key))
  const left = now.filter((p) => !sent.has(p.key))
  if (left.length === 0) await idbDelete('kv', pendingKey(userId))
  else await idbPut('kv', pendingKey(userId), left)
}

// reliable = false si no se sabe qué se ha enseñado (sin red y sin copia): entonces no se
// enseñan pop-ups para no repetir alguno visto en otro dispositivo.
export async function loadShownMilestones(
  userId: string,
): Promise<{ items: ShownMilestone[]; reliable: boolean }> {
  try {
    await flushPending(userId)
    const server = await fetchShownMilestones(userId)
    const pending = (await idbGet<ShownMilestone[]>('kv', pendingKey(userId))) ?? []
    const items = merge(server, pending)
    await idbPut('kv', cacheKey(userId), items)
    return { items, reliable: true }
  } catch {
    const cached = await idbGet<ShownMilestone[]>('kv', cacheKey(userId))
    const pending = (await idbGet<ShownMilestone[]>('kv', pendingKey(userId))) ?? []
    return { items: merge(cached ?? [], pending), reliable: cached !== undefined }
  }
}

export async function markMilestonesShown(userId: string, keys: string[], now = new Date()) {
  if (keys.length === 0) return
  const items = keys.map((key) => ({ key, shownAt: now.toISOString() }))
  const pending = (await idbGet<ShownMilestone[]>('kv', pendingKey(userId))) ?? []
  await idbPut('kv', pendingKey(userId), merge(pending, items))
  const cached = (await idbGet<ShownMilestone[]>('kv', cacheKey(userId))) ?? []
  await idbPut('kv', cacheKey(userId), merge(cached, items))
  try {
    await flushPending(userId)
  } catch {
    // Sin conexión: se suben en la próxima carga.
  }
}

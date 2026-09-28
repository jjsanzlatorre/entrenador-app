// Envoltorio mínimo de IndexedDB. Si IndexedDB no está disponible (SSR, modo privado raro),
// cae a memoria para que la app siga funcionando.

export type StoreName = 'sessions' | 'outbox' | 'kv'

const DB_NAME = 'entrenador'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null
const memory: Record<StoreName, Map<string, unknown>> = {
  sessions: new Map(),
  outbox: new Map(),
  kv: new Map(),
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'))
  })
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions')
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox')
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        console.error('[idb] no se pudo abrir IndexedDB; se usa memoria', request.error)
        resolve(null)
      }
    } catch (error) {
      console.error('[idb] IndexedDB no disponible; se usa memoria', error)
      resolve(null)
    }
  })
  return dbPromise
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  if (!db) throw new Error('no-idb')
  const tx = db.transaction(store, mode)
  const result = requestToPromise(fn(tx.objectStore(store)))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx error'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx abort'))
  })
  return result
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return (await withStore(store, 'readonly', (s) => s.get(key))) as T | undefined
  } catch (error) {
    if ((error as Error).message !== 'no-idb') throw error
    return memory[store].get(key) as T | undefined
  }
}

export async function idbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
  try {
    await withStore(store, 'readwrite', (s) => s.put(value, key))
  } catch (error) {
    if ((error as Error).message !== 'no-idb') throw error
    memory[store].set(key, value)
  }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  try {
    await withStore(store, 'readwrite', (s) => s.delete(key))
  } catch (error) {
    if ((error as Error).message !== 'no-idb') throw error
    memory[store].delete(key)
  }
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  try {
    return (await withStore(store, 'readonly', (s) => s.getAll())) as T[]
  } catch (error) {
    if ((error as Error).message !== 'no-idb') throw error
    return [...memory[store].values()] as T[]
  }
}

// Solo para tests: cierra la conexión y borra la base de datos.
export async function __resetIdbForTests() {
  const db = dbPromise ? await dbPromise : null
  db?.close()
  dbPromise = null
  for (const m of Object.values(memory)) m.clear()
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

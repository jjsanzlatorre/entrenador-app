// Configuración de las notificaciones push (solo servidor).
// - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: par de claves VAPID (base64url). Se generan en
//   Perfil → Notificaciones (solo admin) sin salir del navegador.
// - VAPID_SUBJECT: contacto para los servicios de push («mailto:tu@email» o una URL https).
// - CRON_SECRET: secreto compartido con pg_cron para llamar a /api/push/cron.
// Sin claves, las notificaciones quedan desactivadas y la app funciona igual.

type Env = Record<string, string | undefined>

export type PushConfig = {
  publicKey: string | null
  privateKey: string | null
  subject: string
  cronSecret: string | null
  configured: boolean
  problem: string | null
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

function clean(value: string | undefined) {
  const v = value?.trim().replace(/^['"]|['"]$/g, '')
  return v ? v : undefined
}

export function getPushConfig(env: Env = process.env): PushConfig {
  const publicKey = clean(env.VAPID_PUBLIC_KEY) ?? null
  const privateKey = clean(env.VAPID_PRIVATE_KEY) ?? null
  const rawSubject = clean(env.VAPID_SUBJECT)
  const subject =
    rawSubject && /^(mailto:|https:\/\/)/.test(rawSubject)
      ? rawSubject
      : rawSubject && rawSubject.includes('@')
        ? `mailto:${rawSubject}`
        : 'mailto:admin@example.invalid'
  const cronSecret = clean(env.CRON_SECRET) ?? null

  const problem = !publicKey
    ? 'Falta VAPID_PUBLIC_KEY'
    : !privateKey
      ? 'Falta VAPID_PRIVATE_KEY'
      : !BASE64URL.test(publicKey) || publicKey.length < 80
        ? 'VAPID_PUBLIC_KEY no tiene el formato esperado (base64url, 87 caracteres)'
        : !BASE64URL.test(privateKey) || privateKey.length < 40
          ? 'VAPID_PRIVATE_KEY no tiene el formato esperado (base64url, 43 caracteres)'
          : null
  return {
    publicKey,
    privateKey,
    subject,
    cronSecret,
    configured: problem === null,
    problem,
  }
}

// Para /api/health: solo booleanos.
export function describePushEnv(env: Env = process.env) {
  const config = getPushConfig(env)
  return {
    configured: config.configured,
    problem: config.problem,
    VAPID_SUBJECT: Boolean(clean(env.VAPID_SUBJECT)),
    CRON_SECRET: Boolean(config.cronSecret),
  }
}

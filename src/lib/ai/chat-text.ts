// Texto del chat del entrenador (§11.5): qué modelo usar según lo que pide el usuario, si la
// respuesta de la IA promete tarjetas (o afirma haber hecho algo) y el texto honesto cuando no hay
// ninguna tarjeta que enseñar. Funciones puras (se prueban sin la IA).
import type { ChatResult } from './schemas'

// Sin acentos y en minúsculas.
function plain(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const WEEKDAYS = 'lunes|martes|miercoles|jueves|viernes|sabado|domingo'

// Peticiones de planificar varios días o sesiones: van al modelo pesado (GEMINI_MODEL_HEAVY).
const MULTI_DAY = [
  /\bplan(es|ifica\w*)?\b/,
  /\bsemanas?\b/,
  /\b(fin de semana|finde)\b/,
  /\bdias\b/,
  /\bsesiones\b/,
  /\bentrenos\b/,
  /\bde hoy (al?|hasta)\b/,
  /\bhasta el\b/,
  /\bde aqui (al?|hasta)\b/,
  /\bproxim[oa]s\b/,
  new RegExp(`\\b(${WEEKDAYS})\\b`),
]

export function chatTier(message: string): 'light' | 'heavy' {
  const text = plain(message)
  return MULTI_DAY.some((re) => re.test(text)) ? 'heavy' : 'light'
}

// El texto habla de tarjetas o botones que el usuario debería ver.
const PROMISES = [
  /\btarjetas?\b/,
  /\bte (propongo|preparo|dejo|pongo) (anadir|mover|cambiar|saltar|crear|preparar|un plan|una sesion|unas sesiones|un par de sesiones|varias sesiones|\d+ sesiones|estas sesiones|el ajuste|un bloque)/,
  /\b(pulsa|toca|dale a|dale al|usa el boton)\s*(en\s*)?[«"“']?\s*(anadir|crear plan|aceptar|mover|preparar|descanso|cambiar)/,
  /\b(abajo|debajo) (tienes|te dejo|veras|aparece|aparecen)\b/,
  /\bte (la|las|lo|los) dejo (abajo|debajo)\b/,
  /\b(como|en) (esta|estas) que te dejo\b/,
]

// El texto afirma que algo ya está hecho (la IA nunca aplica nada: solo propone).
const CLAIMS = [
  /\b(ya )?(te )?(he|hemos) (creado|anadido|puesto|programado|guardado|movido|cambiado|actualizado|modificado|metido|agendado)\b/,
  /\bya (lo |la |los |las )?tienes (en|el plan|la sesion|las sesiones|tu plan)\b/,
  /\b(queda|quedan|esta|estan) (ya )?(en tu calendario|en tu plan|programad[oa]s?|anadid[oa]s?)\b/,
]

export function promisesCards(reply: string) {
  const text = plain(reply)
  return PROMISES.some((re) => re.test(text)) || CLAIMS.some((re) => re.test(text))
}

// Pide unos días concretos («de hoy al domingo», «esta semana», «el jueves»…) y no un plan de 4
// semanas.
const RANGE = [
  /\bde hoy (al?|hasta)\b/,
  /\bde aqui (al?|hasta)\b/,
  /\bhasta el\b/,
  /\b(fin de semana|finde)\b/,
  /\besta semana\b/,
  new RegExp(`\\b(${WEEKDAYS})\\b`),
]

type HonestOpts = { hasPlan: boolean; weekday: number; message?: string }

function wantsFullPlan(message: string | undefined) {
  if (!message) return false
  const text = plain(message)
  return /\bplan\b/.test(text) && !RANGE.some((re) => re.test(text))
}

// Ejemplo concreto de cómo pedirlo (para el texto honesto).
export function exampleRequest(opts: HonestOpts) {
  if (!opts.hasPlan || wantsFullPlan(opts.message)) return '«Créame un plan de 3 días de fuerza»'
  // Domingo: el bloque va de mañana al domingo siguiente.
  return opts.weekday === 7
    ? '«Prepárame sesiones suaves de recuperación de mañana al domingo»'
    : '«Prepárame sesiones suaves de recuperación de hoy al domingo, sin tocar mi plan»'
}

// Texto que sustituye al de la IA cuando promete tarjetas y no hay ninguna.
export function honestReply(opts: HonestOpts) {
  const what = wantsFullPlan(opts.message) ? 'el plan' : 'las sesiones'
  const how =
    opts.hasPlan || wantsFullPlan(opts.message)
      ? 'Prueba a pedírmelo así: '
      : 'Para añadir sesiones necesitas un plan activo. Prueba a pedírmelo así: '
  return `No he podido preparar ${what}. ${how}${exampleRequest(opts)}.`
}

export function fewerCardsNote(shown: number) {
  return shown === 1
    ? 'Ojo: solo he podido preparar la tarjeta que ves abajo; el resto no se podía aplicar.'
    : `Ojo: solo he podido preparar las ${shown} tarjetas que ves abajo; el resto no se podía aplicar.`
}

// Tarjetas que se enseñaron en una respuesta anterior (para que la IA sepa lo que el usuario ve
// en la conversación).
export function cardsSummary(output: Partial<ChatResult> | null | undefined) {
  if (!output) return null
  const items: string[] = []
  if (output.plan_request) items.push(`create_plan «${output.plan_request.title}»`)
  if (output.adjust_today) items.push(`adjust_today «${output.adjust_today.title}»`)
  for (const r of output.ranges ?? []) {
    items.push(
      `add_sessions_range «${r.title}» (${r.days.map((d) => `${d.date} ${d.session.title}`).join('; ')})`,
    )
  }
  for (const c of output.changes ?? []) {
    items.push(`${c.action}_session «${c.title}»${c.date ? ` ${c.date}` : ''}`)
  }
  return items.length ? `[Tarjetas mostradas: ${items.join(' | ')}]` : '[Sin tarjetas]'
}

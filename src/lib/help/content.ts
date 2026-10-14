// Textos de «Cómo funciona» (Perfil → Ayuda). Cortos: lo imprescindible de cada pantalla.
export const HELP_SECTIONS: { id: string; emoji: string; title: string; points: string[] }[] = [
  {
    id: 'today',
    emoji: '☀️',
    title: 'Hoy',
    points: [
      'Arriba tienes la sesión del día y el botón para empezar; debajo, tu semana.',
      '«Empezar entreno» → «Repetir último entreno» o una de tus plantillas: dos toques y a entrenar.',
      '«Más de hoy» guarda lo demás (check-in, revisión semanal, entrenador, pareja).',
    ],
  },
  {
    id: 'session',
    emoji: '🏋️',
    title: 'Registrar una sesión',
    points: [
      'Los pesos vienen de la última vez (o de la sugerencia de progresión 💡).',
      'Toca ✓ o desliza la serie a la derecha para completarla: arranca el descanso y la siguiente serie se rellena con los mismos valores.',
      'Desliza a la izquierda para borrar una serie (con «Deshacer»). «Añadir serie» copia la última.',
      'Superserie: mantén pulsado el nombre de un ejercicio y suéltalo sobre otro, o ⋮ → «Unir con el siguiente».',
      'Todo se guarda en el móvil al momento; sin conexión se sube después.',
    ],
  },
  {
    id: 'templates',
    emoji: '📋',
    title: 'Repetir y plantillas',
    points: [
      'En el historial, «Repetir» copia un entreno con los pesos sugeridos.',
      'Al ver una sesión terminada, «Guardar como plantilla». Las tienes en «Empezar entreno» → «Mis plantillas».',
    ],
  },
  {
    id: 'activity',
    emoji: '⚡',
    title: 'Actividades y cardio',
    points: [
      'Deportes, clases y yoga: «Actividad» → elige → duración y esfuerzo → Guardar.',
      'Carrera, natación y bici: «Empezar entreno» → tipo; el cronómetro guarda tiempo y distancia.',
      'Tiempos y distancias aceptan «25», «25:30», «1h05», «5 km» o «400 m».',
    ],
  },
  {
    id: 'plan',
    emoji: '📅',
    title: 'Plan',
    points: [
      'Elige una plantilla o pídeselo al entrenador IA; se reparte en tus días.',
      'Toca una sesión para empezarla, moverla o saltarla. Mantén pulsada y arrástrala a otro día.',
      '⋯ «Opciones del plan»: desplazar, pausar, repetir semana y deshacer el último cambio.',
    ],
  },
  {
    id: 'progress',
    emoji: '📈',
    title: 'Progreso',
    points: [
      'Cumplimiento: lo hecho frente a lo que te comprometiste (Perfil → Mi compromiso).',
      'Mapa muscular: series efectivas por músculo; carga: avisos de sobrecarga.',
      'Récords, gráficas por ejercicio, medidas, fotos (siempre privadas) y logros.',
    ],
  },
  {
    id: 'coach',
    emoji: '💬',
    title: 'Entrenador IA',
    points: [
      'Pregúntale lo que quieras; cuando proponga cambios verás tarjetas con «Aceptar».',
      'Nada se aplica sin que lo aceptes.',
    ],
  },
  {
    id: 'partners',
    emoji: '🤝',
    title: 'Pareja y amigos',
    points: [
      'Perfil → «Pareja y amigos»: invita con un enlace y elige qué compartes con cada persona.',
      '«Entrenar con…» manda la estructura de tu sesión; cada uno registra sus pesos.',
    ],
  },
  {
    id: 'feedback',
    emoji: '🐞',
    title: 'Feedback',
    points: [
      'Menú ⋯ (arriba a la derecha en cualquier pantalla) → «Enviar feedback».',
      'Se adjuntan la pantalla, la fecha y el dispositivo para poder arreglarlo.',
    ],
  },
]

import { useEffect } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'

function describe(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error), stack: undefined }
}

export function logError(scope: string, error: unknown) {
  const { message, stack } = describe(error)
  console.error(`[${scope}] ${message}`, stack ?? '')
}

// Página de error en español. Se renderiza en el servidor y funciona sin JavaScript:
// los botones son enlaces normales.
export function RootError({ error }: ErrorComponentProps) {
  const { message } = describe(error)

  // En SSR esto sale en los Runtime Logs de Vercel.
  if (typeof window === 'undefined') logError('ErrorComponent/SSR', error)

  useEffect(() => {
    logError('ErrorComponent', error)
  }, [error])

  return (
    <main
      role="alert"
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Algo ha fallado</h1>
      <p style={{ color: '#666', marginTop: 12 }}>
        No se ha podido cargar esta página. Prueba de nuevo en unos segundos.
      </p>
      <pre
        style={{
          marginTop: 20,
          padding: 12,
          borderRadius: 8,
          background: '#f4f4f5',
          color: '#b91c1c',
          fontSize: 13,
          textAlign: 'left',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message || 'Error desconocido'}
      </pre>
      <p style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
        <a href="" style={linkStyle}>
          Reintentar
        </a>
        <a href="/" style={linkStyle}>
          Ir a Hoy
        </a>
      </p>
    </main>
  )
}

const linkStyle = {
  display: 'inline-block',
  padding: '10px 18px',
  borderRadius: 8,
  background: '#2563eb',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 600,
} as const

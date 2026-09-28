import { createMiddleware } from '@tanstack/react-start'
import { loadAuthState } from './auth.server'

// Middleware de funciones de servidor: exige usuario autenticado y activo.
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const auth = await loadAuthState()
  if (auth.status !== 'active') {
    throw new Error(auth.status === 'inactive' ? 'Cuenta desactivada' : 'No autenticado')
  }
  return next({ context: { auth } })
})

// Exige además rol admin.
export const adminMiddleware = createMiddleware({ type: 'function' })
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    if (context.auth.profile.role !== 'admin') {
      throw new Error('Solo el admin puede hacer esto')
    }
    return next()
  })

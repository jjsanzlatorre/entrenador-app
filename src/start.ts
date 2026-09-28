import { createMiddleware, createStart } from '@tanstack/react-start'
import { logError } from '@/components/root-error'

// Registra en los logs del servidor (Vercel → Runtime Logs) cualquier error no controlado.
const requestErrorLogger = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next()
  } catch (error) {
    logError(`request ${request.method} ${new URL(request.url).pathname}`, error)
    throw error
  }
})

const serverFnErrorLogger = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    logError('serverFn', error)
    throw error
  }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [requestErrorLogger],
  functionMiddleware: [serverFnErrorLogger],
}))

import { createServerFn } from '@tanstack/react-start'
import { loadAuthState } from './auth.server'

export const getAuthState = createServerFn({ method: 'GET' }).handler(() => loadAuthState())

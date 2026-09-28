import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon, Page } from '@/components/page'

export const Route = createFileRoute('/_app/')({
  component: TodayPage,
})

function TodayPage() {
  const { auth } = Route.useRouteContext()
  const name = auth.profile.display_name

  return (
    <Page title={name ? `Hola, ${name}` : 'Hoy'}>
      <ComingSoon phase={3}>Aquí verás tu barra de cumplimiento de la semana.</ComingSoon>
      <ComingSoon phase={5}>Y la sesión planificada para hoy.</ComingSoon>
    </Page>
  )
}

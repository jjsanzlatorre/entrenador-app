import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon, Page } from '@/components/page'

export const Route = createFileRoute('/_app/entrenar')({
  component: () => (
    <Page title="Entrenar">
      <ComingSoon phase={1}>
        Registro de sesiones de fuerza con temporizador de descanso.
      </ComingSoon>
    </Page>
  ),
})

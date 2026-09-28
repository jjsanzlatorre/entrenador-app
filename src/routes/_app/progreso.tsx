import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon, Page } from '@/components/page'

export const Route = createFileRoute('/_app/progreso')({
  component: () => (
    <Page title="Progreso">
      <ComingSoon phase={3}>Récords, gráficas, cumplimiento y logros.</ComingSoon>
    </Page>
  ),
})

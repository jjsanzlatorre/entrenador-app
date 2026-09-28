import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon, Page } from '@/components/page'

export const Route = createFileRoute('/_app/plan')({
  component: () => (
    <Page title="Plan">
      <ComingSoon phase={5}>Planes de 4 semanas a partir de plantillas.</ComingSoon>
    </Page>
  ),
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSeedFiles } from '../../scripts/seed-sql'

describe('semillas', () => {
  it('el SQL de semilla está sincronizado con los JSON (ejecuta npm run seed:sql)', () => {
    for (const { file, sql } of buildSeedFiles()) {
      const onDisk = readFileSync(
        join(import.meta.dirname, '../../supabase/migrations', file),
        'utf8',
      )
      expect(onDisk, file).toBe(sql)
    }
  })
})

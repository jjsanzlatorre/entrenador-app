import { describe, expect, it } from 'vitest'
import { crc32, createZip, csvCell, toCsv } from './files'
import { buildCsvFiles, type ExportData } from './collect'

describe('CSV', () => {
  it('escapa comillas, comas y saltos de línea, y neutraliza fórmulas', () => {
    expect(csvCell('hola')).toBe('hola')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell(null)).toBe('')
    expect(csvCell(82.5)).toBe('82.5')
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell({ strength: 2 })).toBe('"{""strength"":2}"')
  })
  it('cabecera + filas con BOM', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], ['a', 'b'])
    expect(csv).toBe('﻿a,b\r\n1,x\r\n')
  })
})

describe('ZIP', () => {
  it('crc32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('estructura válida: cabeceras locales, directorio central y fin', () => {
    const zip = createZip([
      { name: 'a.csv', data: 'hola', date: new Date(2026, 0, 1) },
      { name: 'ñ.txt', data: new Uint8Array([1, 2, 3]) },
    ])
    const v = new DataView(zip.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = zip.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(2)
    const centralOffset = v.getUint32(end + 16, true)
    expect(v.getUint32(centralOffset, true)).toBe(0x02014b50)
    // el contenido va sin comprimir tras la cabecera local
    expect(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 4))).toBe('hola')
  })
})

describe('CSV de la exportación', () => {
  it('series con nombre del ejercicio y fecha de la sesión; sin datos de otros', () => {
    const data: ExportData = {
      app: 'entrenador',
      version: 1,
      exported_at: '2026-09-29T10:00:00Z',
      user_id: 'u',
      tables: {
        workout_sessions: [
          {
            id: 's1',
            session_type: 'strength',
            started_at: '2026-09-28T08:00:00Z',
            rpe: 8,
            duration_min: 60,
          },
        ],
        session_blocks: [{ id: 'b1', order: 0, block_type: 'straight' }],
        exercise_sets: [
          {
            session_id: 's1',
            block_id: 'b1',
            exercise_id: 'bench_press',
            set_index: 0,
            weight_kg: 80,
            reps: 5,
            completed: true,
            is_warmup: false,
          },
        ],
        body_metrics: [{ date: '2026-09-01', weight_kg: 80 }],
        personal_records: [],
        commitments: [],
      },
    }
    const files = buildCsvFiles(data, new Map([['bench_press', 'Press banca']]))
    expect(files.map((f) => f.name)).toEqual([
      'sesiones.csv',
      'series.csv',
      'medidas.csv',
      'records.csv',
      'compromisos.csv',
    ])
    const series = String(files[1]!.data)
    expect(series).toContain(
      's1,2026-09-28T08:00:00Z,0,straight,bench_press,Press banca,0,false,80,5',
    )
    expect(String(files[0]!.data)).toContain(',480,') // carga sRPE = 8 × 60
  })
})

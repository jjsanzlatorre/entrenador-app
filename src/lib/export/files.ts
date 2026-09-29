// Exportar datos (fase 7B): CSV y ZIP sin dependencias. Lógica pura, con tests.

type Cell = string | number | boolean | null | undefined | object

// Un valor → celda CSV (RFC 4180): comillas si hace falta, objetos como JSON.
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'boolean'
        ? value
          ? 'true'
          : 'false'
        : String(value)
  // Evita que una hoja de cálculo interprete como fórmula un texto escrito por el usuario.
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// Filas → CSV con cabecera (las columnas se toman de la primera fila si no se indican).
// Con BOM UTF-8 para que Excel lea bien los acentos.
export function toCsv(rows: Record<string, Cell>[], columns?: string[]) {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : [])
  const lines = [cols.map(csvCell).join(',')]
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// ── ZIP (sin compresión: CSV y JPEG ya ocupan poco o ya van comprimidos) ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array | string; date?: Date }

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date =
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const crc = crc32(data)
    const { time, date } = dosDateTime(entry.date ?? new Date())

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // versión necesaria
    lv.setUint16(6, 0x0800, true) // nombres en UTF-8
    lv.setUint16(8, 0, true) // sin compresión
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const header = new Uint8Array(46 + name.length)
    const hv = new DataView(header.buffer)
    hv.setUint32(0, 0x02014b50, true)
    hv.setUint16(4, 20, true)
    hv.setUint16(6, 20, true)
    hv.setUint16(8, 0x0800, true)
    hv.setUint16(10, 0, true)
    hv.setUint16(12, time, true)
    hv.setUint16(14, date, true)
    hv.setUint32(16, crc, true)
    hv.setUint32(20, data.length, true)
    hv.setUint32(24, data.length, true)
    hv.setUint16(28, name.length, true)
    hv.setUint32(42, offset, true)
    header.set(name, 46)

    chunks.push(local, data)
    central.push(header)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let pos = 0
  for (const c of [...chunks, ...central, end]) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

// Descarga un archivo en el navegador.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

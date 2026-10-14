import { describe, expect, it } from 'vitest'
import {
  describeDistance,
  describeDuration,
  describeQuantity,
  formatDistanceInput,
  formatDurationInput,
  formatQuantityInput,
  formatWeightInput,
  parseCount,
  parseDistance,
  parseDuration,
  parseNumber,
  parseQuantity,
  parseWeight,
  stepQuantity,
  type QuantityKind,
} from './quantity'

describe('parseDuration: número suelto según el campo', () => {
  it.each([
    ['25', 'min', 1500],
    ['25', 's', 25],
    ['90', 's', 90],
    ['90', 'min', 5400],
    ['0', 'min', 0],
    ['2,5', 'min', 150],
    ['2.5', 'min', 150],
    ['1,5', 's', 2],
    [' 45 ', 's', 45],
    ['007', 's', 7],
  ] as const)('«%s» (%s) = %i s', (input, bare, expected) => {
    expect(parseDuration(input, bare)).toBe(expected)
  })
})

describe('parseDuration: con dos puntos', () => {
  it.each([
    ['25:30', 1530],
    ['1:30', 90],
    ['0:45', 45],
    ['1:05:00', 3900],
    ['2:00:30', 7230],
    ['1:5', 65],
    ['1:30 min', 90],
    ['1:30h', 5400],
    ['1:30 horas', 5400],
    ['1:05:00 h', 3900],
  ] as const)('«%s» = %i s (igual en min y en s)', (input, expected) => {
    expect(parseDuration(input, 'min')).toBe(expected)
    expect(parseDuration(input, 's')).toBe(expected)
  })

  it.each([
    '25:75',
    '1:60:00',
    '1:30:75',
    ':30',
    '1:',
    '1::30',
    '1:30:00:00',
    '1:30 s',
    '1:30:00 min',
    '1:30 km',
  ])('«%s» no vale', (input) => {
    expect(parseDuration(input, 'min')).toBeNull()
    expect(parseDuration(input, 's')).toBeNull()
  })
})

describe('parseDuration: con unidades', () => {
  it.each([
    ['1h05', 3900],
    ['1h 05', 3900],
    ['1 h 5 min', 3900],
    ['1h05m', 3900],
    ['1h', 3600],
    ['1 hora', 3600],
    ['2 horas', 7200],
    ['1,5 h', 5400],
    ['1.5h', 5400],
    ['90s', 90],
    ['90 s', 90],
    ['30 seg', 30],
    ['30 segundos', 30],
    ['45 sec', 45],
    ['2\'30"', 150],
    ["2'30", 150],
    ["2'", 120],
    ['30"', 30],
    ["30''", 30],
    ['2’30”', 150],
    ['2′30″', 150],
    ['2m30s', 150],
    ['2m30', 150],
    ['2 min 30 s', 150],
    ['25 min', 1500],
    ['25min', 1500],
    ['25 minutos', 1500],
    ['1 minuto', 60],
    ['1h0m30s', 3630],
    ['1h 0', 3600],
    ['2,5 min', 150],
    ['1H05', 3900],
    ['25 MIN', 1500],
  ] as const)('«%s» = %i s', (input, expected) => {
    expect(parseDuration(input, 'min')).toBe(expected)
    expect(parseDuration(input, 's')).toBe(expected)
  })

  it.each([
    '1h75',
    '2m90s',
    '30s15',
    '1h2h',
    '30s1m',
    '1m1h',
    '1h1,5',
    '5 km',
    'h',
    'min',
    'abc',
    '-5',
    '−5',
    '25 30',
    '1h05x',
    '5x',
    '1h-05',
  ])('«%s» no vale', (input) => {
    expect(parseDuration(input, 'min')).toBeNull()
    expect(parseDuration(input, 's')).toBeNull()
  })

  it('vacío → null', () => {
    expect(parseDuration('', 'min')).toBeNull()
    expect(parseDuration('   ', 's')).toBeNull()
  })
})

describe('parseDistance', () => {
  it.each([
    ['5', 'km', 5000],
    ['5,2', 'km', 5200],
    ['5.25', 'km', 5250],
    ['21,0975', 'km', 21098],
    ['400', 'm', 400],
    ['1500', 'm', 1500],
    ['1.500', 'm', 1500],
    ['10.000 m', 'km', 10000],
    ['400 m', 'km', 400],
    ['400m', 'km', 400],
    ['400 metros', 'km', 400],
    ['5 km', 'm', 5000],
    ['5km', 'm', 5000],
    ['5k', 'm', 5000],
    ['5 kilómetros', 'm', 5000],
    ['5 KM', 'm', 5000],
    ['0,5', 'km', 500],
    [',5', 'km', 500],
    ['25', 'm', 25],
    ['12,5', 'm', 13],
  ] as const)('«%s» (%s) = %i m', (input, bare, expected) => {
    expect(parseDistance(input, bare)).toBe(expected)
  })

  it.each(['', 'km', '5 millas', '5 x', '-5', '1.2.3', '5:00', '5 5'])('«%s» no vale', (input) => {
    expect(parseDistance(input, 'km')).toBeNull()
  })

  it('el punto de miles solo vale en metros', () => {
    expect(parseDistance('1.500', 'km')).toBe(1500)
    expect(parseDistance('1.500', 'm')).toBe(1500)
    expect(parseDistance('1.5', 'm')).toBe(2)
  })
})

describe('parseWeight', () => {
  it.each([
    ['62,5', 62.5],
    ['62.5', 62.5],
    ['62,5 kg', 62.5],
    ['80kg', 80],
    ['80 kilos', 80],
    ['0', 0],
    ['135 lb', 61.23],
    ['45lbs', 20.41],
    ['100 libras', 45.36],
    ['20,125', 20.13],
  ] as const)('«%s» = %f kg', (input, expected) => {
    expect(parseWeight(input)).toBe(expected)
  })

  it.each(['', 'kg', '-5', '62,5,5', '5 km', 'abc', '1:30'])('«%s» no vale', (input) => {
    expect(parseWeight(input)).toBeNull()
  })
})

describe('parseCount y parseNumber', () => {
  it('enteros con unidad opcional', () => {
    expect(parseCount('12')).toBe(12)
    expect(parseCount('12 reps')).toBe(12)
    expect(parseCount('150 ppm')).toBe(150)
    expect(parseCount('300 kcal')).toBe(300)
    expect(parseCount('8 rondas')).toBe(8)
    expect(parseCount('8,5')).toBeNull()
    expect(parseCount('-3')).toBeNull()
    expect(parseCount('')).toBeNull()
    expect(parseCount('doce')).toBeNull()
  })

  it('decimales con coma o punto', () => {
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('12.5')).toBe(12.5)
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('12 cm')).toBeNull()
    expect(parseNumber('-1')).toBeNull()
  })
})

describe('textos y formato de entrada', () => {
  it('describeDuration', () => {
    expect(describeDuration(1500)).toBe('25 min')
    expect(describeDuration(1530)).toBe('25 min 30 s')
    expect(describeDuration(3900)).toBe('1 h 5 min')
    expect(describeDuration(3630)).toBe('1 h 30 s')
    expect(describeDuration(90)).toBe('1 min 30 s')
    expect(describeDuration(45)).toBe('45 s')
    expect(describeDuration(0)).toBe('0 s')
  })

  it('describeDistance', () => {
    expect(describeDistance(5000, 'km')).toBe('5 km')
    expect(describeDistance(5200, 'km')).toBe('5,2 km')
    expect(describeDistance(400, 'm')).toBe('400 m')
  })

  it('formatDurationInput vuelve a dar lo mismo al parsear', () => {
    for (const [bare, seconds] of [
      ['min', 1500],
      ['min', 1530],
      ['min', 3900],
      ['s', 45],
      ['s', 90],
      ['s', 3661],
    ] as const) {
      expect(parseDuration(formatDurationInput(seconds, bare), bare)).toBe(seconds)
    }
    expect(formatDurationInput(1500, 'min')).toBe('25')
    expect(formatDurationInput(1530, 'min')).toBe('25:30')
    expect(formatDurationInput(45, 's')).toBe('45')
    expect(formatDurationInput(90, 's')).toBe('1:30')
    expect(formatDurationInput(3900, 's')).toBe('1:05:00')
    expect(formatDurationInput(null, 's')).toBe('')
  })

  it('formatDistanceInput y formatWeightInput', () => {
    expect(formatDistanceInput(5200, 'km')).toBe('5,2')
    expect(formatDistanceInput(12000, 'km')).toBe('12')
    expect(formatDistanceInput(1500, 'm')).toBe('1500')
    expect(parseDistance(formatDistanceInput(21098, 'km'), 'km')).toBe(21098)
    expect(formatWeightInput(62.5)).toBe('62,5')
    expect(formatWeightInput(1000)).toBe('1000')
    expect(formatWeightInput(null)).toBe('')
  })

  it('parseQuantity, formatQuantityInput y describeQuantity según el campo', () => {
    const specs: [QuantityKind, string, number, string][] = [
      [{ kind: 'duration', bare: 'min' }, '25:30', 1530, '25 min 30 s'],
      [{ kind: 'duration', bare: 's' }, '90', 90, '1 min 30 s'],
      [{ kind: 'distance', bare: 'km' }, '5', 5000, '5 km'],
      [{ kind: 'distance', bare: 'm' }, '400', 400, '400 m'],
      [{ kind: 'weight' }, '62,5', 62.5, '62,5 kg'],
      [{ kind: 'count', unit: 'ppm' }, '150', 150, '150 ppm'],
      [{ kind: 'number', unit: '%' }, '18,5', 18.5, '18,5 %'],
    ]
    for (const [spec, input, value, text] of specs) {
      expect(parseQuantity(input, spec)).toBe(value)
      expect(parseQuantity(formatQuantityInput(value, spec), spec)).toBe(value)
      expect(describeQuantity(value, spec)).toBe(text)
    }
  })

  it('stepQuantity en la unidad del campo, sin bajar de 0', () => {
    expect(stepQuantity(1500, 5, { kind: 'duration', bare: 'min' })).toBe(1800)
    expect(stepQuantity(60, -5, { kind: 'duration', bare: 'min' })).toBe(0)
    expect(stepQuantity(30, 5, { kind: 'duration', bare: 's' })).toBe(35)
    expect(stepQuantity(5000, 1, { kind: 'distance', bare: 'km' })).toBe(6000)
    expect(stepQuantity(400, 25, { kind: 'distance', bare: 'm' })).toBe(425)
    expect(stepQuantity(null, 2.5, { kind: 'weight' })).toBe(2.5)
    expect(stepQuantity(3, -5, { kind: 'count' })).toBe(0)
  })
})

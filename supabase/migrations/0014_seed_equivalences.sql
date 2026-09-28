-- 0014_seed_equivalences.sql
-- Semilla: objetos de equivalencia y destinos (CLAUDE.md §10B). Valores aproximados. Requiere 0013.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.equivalence_objects (
  id, kind, label, label_plural, article, emoji, value, phrase_template, min_value
) values
  -- Fuente: Formato comercial estándar de cemento en España: saco de 25 kg.
  ('cement_bag', 'weight', 'saco de cemento', 'sacos de cemento', 'un', '🧱', 25, 'Has levantado el peso de {qty}', 5),
  -- Fuente: Fichas técnicas de lavadoras domésticas de carga frontal (≈ 60–80 kg).
  ('washing_machine', 'weight', 'lavadora', 'lavadoras', 'una', '🧺', 70, 'Has levantado el peso de {qty}', 20),
  -- Fuente: Fichas técnicas de motos de media cilindrada (≈ 180–220 kg en orden de marcha).
  ('motorbike', 'weight', 'moto', 'motos', 'una', '🏍️', 200, 'Has levantado el peso de {qty}', 50),
  -- Fuente: Encyclopaedia Britannica, Brown bear: machos adultos ≈ 300 kg (muy variable).
  ('brown_bear', 'weight', 'oso pardo', 'osos pardos', 'un', '🐻', 300, 'Has levantado el peso de {qty}', 100),
  -- Fuente: Steinway & Sons, Model D (piano de concierto): ≈ 480 kg.
  ('grand_piano', 'weight', 'piano de cola', 'pianos de cola', 'un', '🎹', 480, 'Has levantado el peso de {qty}', 150),
  -- Fuente: Caballo adulto de silla: ≈ 450–550 kg (Encyclopaedia Britannica, Horse).
  ('horse', 'weight', 'caballo', 'caballos', 'un', '🐎', 500, 'Has levantado el peso de {qty}', 150),
  -- Fuente: Vaca frisona adulta: ≈ 600–700 kg (asociaciones de criadores de frisona).
  ('cow', 'weight', 'vaca', 'vacas', 'una', '🐄', 650, 'Has levantado el peso de {qty}', 200),
  -- Fuente: Utilitario del segmento B (p. ej. SEAT Ibiza): ≈ 1.100–1.250 kg según ficha técnica.
  ('car', 'weight', 'coche', 'coches', 'un', '🚗', 1200, 'Has levantado el peso de {qty}', 300),
  -- Fuente: Hipopótamo común adulto: ≈ 1.300–1.500 kg (National Geographic).
  ('hippo', 'weight', 'hipopótamo', 'hipopótamos', 'un', '🦛', 1500, 'Has levantado el peso de {qty}', 400),
  -- Fuente: Rinoceronte blanco macho: ≈ 2.000–2.500 kg (WWF).
  ('rhino', 'weight', 'rinoceronte', 'rinocerontes', 'un', '🦏', 2300, 'Has levantado el peso de {qty}', 600),
  -- Fuente: Tractor agrícola mediano (≈ 100–130 CV): ≈ 4.500–5.500 kg según fichas de fabricantes.
  ('tractor', 'weight', 'tractor', 'tractores', 'un', '🚜', 5000, 'Has levantado el peso de {qty}', 1000),
  -- Fuente: Elefante africano de sabana macho: ≈ 6.000 kg (WWF / National Geographic).
  ('african_elephant', 'weight', 'elefante africano', 'elefantes africanos', 'un', '🐘', 6000, 'Has levantado el peso de {qty}', 1500),
  -- Fuente: Tyrannosaurus rex adulto: estimaciones ≈ 6.000–9.000 kg (Natural History Museum, Londres).
  ('t_rex', 'weight', 'tiranosaurio', 'tiranosaurios', 'un', '🦖', 8000, 'Has levantado el peso de {qty}', 2000),
  -- Fuente: Autobús urbano de 12 m (vacío): ≈ 11.000–12.500 kg según fichas de fabricantes.
  ('bus', 'weight', 'autobús', 'autobuses', 'un', '🚌', 12000, 'Has levantado el peso de {qty}', 3000),
  -- Fuente: Camión rígido de 2 ejes cargado: masa máxima autorizada de 18 t (Reglamento General de Vehículos, anexo IX).
  ('truck', 'weight', 'camión', 'camiones', 'un', '🚚', 18000, 'Has levantado el peso de {qty}', 5000),
  -- Fuente: Boeing 737-800, peso operativo en vacío ≈ 41.400 kg (Boeing, Airport Planning).
  ('boeing_737', 'weight', 'Boeing 737 vacío', 'Boeing 737 vacíos', 'un', '🛩️', 41400, 'Has levantado el peso de {qty}', 10000),
  -- Fuente: Locomotora eléctrica de mercancías (p. ej. Renfe 252/253): ≈ 88–90 t.
  ('locomotive', 'weight', 'locomotora', 'locomotoras', 'una', '🚂', 90000, 'Has levantado el peso de {qty}', 20000),
  -- Fuente: Ballena azul adulta: ≈ 100–150 t (NOAA Fisheries).
  ('blue_whale', 'weight', 'ballena azul', 'ballenas azules', 'una', '🐋', 150000, 'Has levantado el peso de {qty}', 30000),
  -- Fuente: Boeing 747-400, peso operativo en vacío ≈ 178.800 kg (Boeing, Airport Planning).
  ('jumbo_jet', 'weight', 'avión de pasajeros (Boeing 747 vacío)', 'aviones de pasajeros (Boeing 747 vacíos)', 'un', '✈️', 180000, 'Has levantado el peso de {qty}', 40000),
  -- Fuente: National Park Service, Statue Statistics: 450.000 lb (225 short tons) ≈ 204 t.
  ('statue_of_liberty', 'weight', 'Estatua de la Libertad', 'Estatuas de la Libertad', 'la', '🗽', 204000, 'Has levantado el peso de {qty}', 40000),
  -- Fuente: NASA, International Space Station Facts and Figures: ≈ 420 t.
  ('iss', 'weight', 'Estación Espacial Internacional', 'Estaciones Espaciales Internacionales', 'la', '🛰️', 420000, 'Has levantado el peso de {qty}', 80000),
  -- Fuente: toureiffel.paris: estructura metálica ≈ 7.300 t (≈ 10.100 t en total).
  ('eiffel_tower', 'weight', 'Torre Eiffel', 'Torres Eiffel', 'la', '🗼', 7300000, 'Has levantado el peso de {qty}', 100000),
  -- Fuente: Lago de Banyoles (Girona): ≈ 2,1 km de largo (Consorci de l'Estany).
  ('banyoles_lake', 'distance_route', 'travesía del lago de Banyoles', 'travesías del lago de Banyoles', 'una', '🏞️', 2100, 'Has nadado {qty}', 500),
  -- Fuente: Bosphorus Cross-Continental Swim (Estambul): recorrido de 6,5 km.
  ('bosphorus', 'distance_route', 'travesía intercontinental del Bósforo', 'travesías intercontinentales del Bósforo', 'una', '🌉', 6500, 'Has nadado {qty}', 1500),
  -- Fuente: World Aquatics: prueba olímpica de aguas abiertas de 10 km.
  ('open_water_10k', 'distance_route', 'maratón olímpico en aguas abiertas', 'maratones olímpicos en aguas abiertas', 'un', '🏅', 10000, 'Has nadado {qty}', 2000),
  -- Fuente: Punto más estrecho (Punta de Tarifa – Punta Cires): ≈ 14,4 km en línea recta.
  ('gibraltar_strait', 'distance_route', 'travesía del Estrecho de Gibraltar', 'travesías del Estrecho de Gibraltar', 'una', '🌊', 14400, 'Has nadado {qty}', 3000),
  -- Fuente: Descenso Internacional del Sella: ≈ 20 km (organización de la prueba).
  ('sella_descent', 'distance_route', 'descenso del Sella (Arriondas–Ribadesella)', 'descensos del Sella', 'un', '🛶', 20000, 'Has nadado {qty}', 4000),
  -- Fuente: Channel Swimming Association: Dover – Cap Gris-Nez ≈ 33,3 km en línea recta.
  ('english_channel', 'distance_route', 'travesía del Canal de la Mancha', 'travesías del Canal de la Mancha', 'una', '⛴️', 33300, 'Has nadado {qty}', 5000),
  -- Fuente: Barcelona – Palma en línea recta (haversine con las coordenadas de destinations.json): ≈ 206 km.
  ('barcelona_mallorca', 'distance_route', 'distancia de Barcelona a Mallorca', 'veces la distancia de Barcelona a Mallorca', 'la', '🏝️', 206000, 'Has nadado {qty}', 20000),
  -- Fuente: Reglas de juego IFAB: 2 partes de 45 min.
  ('football_match', 'time', 'partido de fútbol', 'partidos de fútbol', 'un', '⚽', 90, 'Has entrenado lo que dura {qty}', 30),
  -- Fuente: World Athletics: 2:00:35 (Kelvin Kiptum, Chicago 2023).
  ('marathon_record', 'time', 'maratón del récord del mundo', 'maratones del récord del mundo', 'un', '🏃', 120.6, 'Has entrenado lo que dura {qty}', 40),
  -- Fuente: Titanic (1997), duración 194 min (ficha de la película).
  ('titanic_movie', 'time', 'película «Titanic»', 'películas «Titanic»', 'una', '🎬', 194, 'Has entrenado lo que dura {qty}', 60),
  -- Fuente: Vuelo directo MAD–JFK: ≈ 8 h 30 min según horarios de las aerolíneas.
  ('flight_madrid_ny', 'time', 'vuelo Madrid–Nueva York', 'vuelos Madrid–Nueva York', 'un', '🛫', 510, 'Has entrenado lo que dura {qty}', 120),
  -- Fuente: 24 h (definición).
  ('full_day', 'time', 'día entero sin parar', 'días enteros sin parar', 'un', '🌞', 1440, 'Has entrenado {qty}', 360),
  -- Fuente: NASA: del despegue (16-7-1969) a la entrada en órbita lunar ≈ 76 h.
  ('apollo_11', 'time', 'viaje del Apolo 11 a la Luna', 'viajes del Apolo 11 a la Luna', 'un', '🚀', 4560, 'Has entrenado lo que dura {qty}', 1000),
  -- Fuente: Tour de France 2024: tiempo del ganador 83 h 38 min 56 s (letour.fr).
  ('tour_de_france', 'time', 'Tour de Francia del ganador', 'Tours de Francia del ganador', 'un', '🚴', 5019, 'Has entrenado lo que dura {qty}', 1200)
on conflict (id) do update set
  kind = excluded.kind,
  label = excluded.label,
  label_plural = excluded.label_plural,
  article = excluded.article,
  emoji = excluded.emoji,
  value = excluded.value,
  phrase_template = excluded.phrase_template,
  min_value = excluded.min_value;

-- Destinos. Fuente: Coordenadas del centro de la ciudad (Wikipedia / GeoNames), redondeadas a 4 decimales.
insert into public.destinations (id, name, lat, lng, type, water_route) values
  ('madrid', 'Madrid', 40.4168, -3.7038, 'city', false),
  ('barcelona', 'Barcelona', 41.3874, 2.1686, 'city', false),
  ('valencia', 'Valencia', 39.4699, -0.3763, 'city', false),
  ('sevilla', 'Sevilla', 37.3891, -5.9845, 'city', false),
  ('zaragoza', 'Zaragoza', 41.6488, -0.8891, 'city', false),
  ('malaga', 'Málaga', 36.7213, -4.4214, 'city', false),
  ('murcia', 'Murcia', 37.9922, -1.1307, 'city', false),
  ('bilbao', 'Bilbao', 43.263, -2.935, 'city', false),
  ('alicante', 'Alicante', 38.3452, -0.481, 'city', false),
  ('cordoba', 'Córdoba', 37.8882, -4.7794, 'city', false),
  ('valladolid', 'Valladolid', 41.6523, -4.7245, 'city', false),
  ('vigo', 'Vigo', 42.2406, -8.7207, 'city', false),
  ('a_coruna', 'A Coruña', 43.3623, -8.4115, 'city', false),
  ('granada', 'Granada', 37.1773, -3.5986, 'city', false),
  ('pamplona', 'Pamplona', 42.8125, -1.6458, 'city', false),
  ('san_sebastian', 'San Sebastián', 43.3183, -1.9812, 'city', false),
  ('santander', 'Santander', 43.4623, -3.8099, 'city', false),
  ('salamanca', 'Salamanca', 40.9701, -5.6635, 'city', false),
  ('santiago', 'Santiago de Compostela', 42.8782, -8.5448, 'landmark', false),
  ('toledo', 'Toledo', 39.8628, -4.0273, 'city', false),
  ('cadiz', 'Cádiz', 36.5271, -6.2886, 'city', false),
  ('girona', 'Girona', 41.9794, 2.8214, 'city', false),
  ('palma', 'Palma (Mallorca)', 39.5696, 2.6502, 'island', true),
  ('mahon', 'Mahón (Menorca)', 39.8885, 4.2658, 'island', true),
  ('ibiza', 'Ibiza', 38.9067, 1.4206, 'island', true),
  ('formentera', 'Formentera', 38.7349, 1.4163, 'island', true),
  ('las_palmas', 'Las Palmas de Gran Canaria', 28.1235, -15.4363, 'island', true),
  ('santa_cruz_tenerife', 'Santa Cruz de Tenerife', 28.4636, -16.2518, 'island', true),
  ('lanzarote', 'Arrecife (Lanzarote)', 28.963, -13.5477, 'island', true),
  ('fuerteventura', 'Puerto del Rosario (Fuerteventura)', 28.5004, -13.8627, 'island', true),
  ('tarifa', 'Tarifa (Estrecho de Gibraltar)', 36.0143, -5.6044, 'landmark', false),
  ('gibraltar', 'Peñón de Gibraltar', 36.1408, -5.3536, 'landmark', false),
  ('ceuta', 'Ceuta', 35.8894, -5.3213, 'city', true),
  ('tanger', 'Tánger', 35.7595, -5.834, 'city', true),
  ('lisboa', 'Lisboa', 38.7223, -9.1393, 'city', false),
  ('oporto', 'Oporto', 41.1579, -8.6291, 'city', false),
  ('andorra', 'Andorra la Vella', 42.5063, 1.5218, 'city', false),
  ('paris', 'París', 48.8566, 2.3522, 'city', false),
  ('londres', 'Londres', 51.5074, -0.1278, 'city', true),
  ('roma', 'Roma', 41.9028, 12.4964, 'city', false),
  ('berlin', 'Berlín', 52.52, 13.405, 'city', false),
  ('amsterdam', 'Ámsterdam', 52.3676, 4.9041, 'city', false),
  ('bruselas', 'Bruselas', 50.8503, 4.3517, 'city', false),
  ('viena', 'Viena', 48.2082, 16.3738, 'city', false),
  ('praga', 'Praga', 50.0755, 14.4378, 'city', false),
  ('dublin', 'Dublín', 53.3498, -6.2603, 'city', true),
  ('copenhague', 'Copenhague', 55.6761, 12.5683, 'city', false),
  ('estocolmo', 'Estocolmo', 59.3293, 18.0686, 'city', false),
  ('atenas', 'Atenas', 37.9838, 23.7275, 'city', false),
  ('ajaccio', 'Ajaccio (Córcega)', 41.9192, 8.7386, 'island', true),
  ('cagliari', 'Cagliari (Cerdeña)', 39.2238, 9.1217, 'island', true),
  ('malta', 'La Valeta (Malta)', 35.8989, 14.5146, 'island', true),
  ('marrakech', 'Marrakech', 31.6295, -7.9811, 'city', false),
  ('estambul', 'Estambul', 41.0082, 28.9784, 'city', false),
  ('el_cairo', 'El Cairo', 30.0444, 31.2357, 'city', false),
  ('reikiavik', 'Reikiavik (Islandia)', 64.1466, -21.9426, 'island', true),
  ('nueva_york', 'Nueva York', 40.7128, -74.006, 'city', true)
on conflict (id) do update set
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  type = excluded.type,
  water_route = excluded.water_route;

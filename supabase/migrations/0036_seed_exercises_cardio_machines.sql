-- 0036_seed_exercises_cardio_machines.sql
-- Semilla: máquinas de cardio (escaladora, bici estática, cinta, elíptica, echo bike…) con su técnica. Requiere 0026.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.exercises (
  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,
  default_rest_s, technique_notes
) values
  ('stair_climber', 'Escaladora / StairMaster', array['stairmaster', 'stair climber', 'stepmill', 'step mill', 'escaleras', 'máquina de escaleras', 'subir escaleras']::text[], 'cardio', 'duration_only', array['stair_climber']::text[], false, true, 90, 'Torso erguido, todo el pie en el escalón y las manos solo para equilibrarse.'),
  ('stationary_bike', 'Bici estática', array['stationary bike', 'bicicleta estática', 'upright bike', 'cicloergómetro', 'bike']::text[], 'cardio', 'distance_time', array['stationary_bike']::text[], false, true, 90, 'Sillín a la altura de la cadera, rodilla casi estirada abajo y pedaleo redondo.'),
  ('recumbent_bike', 'Bici reclinada', array['recumbent bike', 'bicicleta reclinada', 'bici horizontal', 'bici con respaldo']::text[], 'cardio', 'distance_time', array['stationary_bike']::text[], false, true, 90, 'Espalda apoyada, rodilla casi estirada al alejar el pedal y ritmo constante.'),
  ('treadmill_run', 'Cinta de correr', array['treadmill', 'cinta', 'correr en cinta', 'treadmill run', 'tapiz rodante']::text[], 'cardio', 'distance_time', array['treadmill']::text[], false, true, 90, 'Paso corto y frecuente, mirada al frente y un 1 % de inclinación para imitar la calle.'),
  ('incline_walk', 'Caminar en cinta inclinada', array['incline walk', 'caminata inclinada', 'treadmill walk', 'andar en cinta', '12-3-30', 'inclined walking']::text[], 'cardio', 'distance_time', array['treadmill']::text[], false, true, 60, 'Inclinación alta y paso firme sin agarrarse: trabaja glúteo y gemelo con poco impacto.'),
  ('curved_treadmill', 'Cinta curva', array['curved treadmill', 'assault runner', 'woodway', 'skillmill', 'cinta sin motor', 'cinta manual']::text[], 'cardio', 'distance_time', array['treadmill']::text[], false, true, 90, 'Sin motor: tú marcas la velocidad. Adelante en la curva acelera, atrás frena.'),
  ('elliptical', 'Elíptica', array['elliptical', 'elliptical trainer', 'bicicleta elíptica', 'cross trainer', 'eliptica']::text[], 'cardio', 'distance_time', array['elliptical']::text[], false, true, 90, 'Sin impacto: pies planos en los pedales, torso erguido y empuja y tira con los brazos.'),
  ('echo_bike', 'Echo bike', array['rogue echo bike', 'fan bike', 'bici de aire echo', 'bike erg de aire']::text[], 'cardio', 'calories', array['echo_bike']::text[], false, true, 120, 'Como la air bike: empuja y tira con brazos y piernas; cuanto más fuerte, más resistencia.'),
  ('bike_erg', 'BikeErg', array['bike erg', 'concept2 bike', 'bici concept2']::text[], 'cardio', 'distance_time', array['bike_erg']::text[], false, true, 90, 'Bici de aire de Concept2: el damper marca la sensación de resistencia; potencia constante.'),
  ('versaclimber', 'VersaClimber', array['versa climber', 'escaladora vertical', 'climber', 'escalador vertical']::text[], 'cardio', 'duration_only', array['versaclimber']::text[], false, true, 90, 'Movimiento de escalar: brazo y pierna contrarios a la vez, con recorridos largos.')
on conflict (id) do update set
  name = excluded.name,
  aliases = excluded.aliases,
  category = excluded.category,
  tracking_type = excluded.tracking_type,
  equipment = excluded.equipment,
  is_unilateral = excluded.is_unilateral,
  is_compound = excluded.is_compound,
  default_rest_s = excluded.default_rest_s,
  technique_notes = excluded.technique_notes
where public.exercises.owner_id is null;

-- Músculos: se reescriben para que la semilla sea la fuente de verdad.
delete from public.exercise_muscles where exercise_id in ('stair_climber', 'stationary_bike', 'recumbent_bike', 'treadmill_run', 'incline_walk', 'curved_treadmill', 'elliptical', 'echo_bike', 'bike_erg', 'versaclimber');

insert into public.exercise_muscles (exercise_id, muscle_id, role) values
  ('stair_climber', 'quads', 'primary'),
  ('stair_climber', 'glutes', 'primary'),
  ('stair_climber', 'calves', 'secondary'),
  ('stair_climber', 'hamstrings', 'secondary'),
  ('stationary_bike', 'quads', 'primary'),
  ('stationary_bike', 'glutes', 'secondary'),
  ('stationary_bike', 'calves', 'secondary'),
  ('stationary_bike', 'hamstrings', 'secondary'),
  ('recumbent_bike', 'quads', 'primary'),
  ('recumbent_bike', 'glutes', 'secondary'),
  ('recumbent_bike', 'hamstrings', 'secondary'),
  ('treadmill_run', 'quads', 'primary'),
  ('treadmill_run', 'hamstrings', 'primary'),
  ('treadmill_run', 'calves', 'secondary'),
  ('treadmill_run', 'glutes', 'secondary'),
  ('incline_walk', 'glutes', 'primary'),
  ('incline_walk', 'calves', 'primary'),
  ('incline_walk', 'hamstrings', 'secondary'),
  ('incline_walk', 'quads', 'secondary'),
  ('curved_treadmill', 'quads', 'primary'),
  ('curved_treadmill', 'hamstrings', 'primary'),
  ('curved_treadmill', 'glutes', 'secondary'),
  ('curved_treadmill', 'calves', 'secondary'),
  ('elliptical', 'quads', 'primary'),
  ('elliptical', 'glutes', 'primary'),
  ('elliptical', 'hamstrings', 'secondary'),
  ('elliptical', 'calves', 'secondary'),
  ('elliptical', 'chest', 'secondary'),
  ('echo_bike', 'quads', 'primary'),
  ('echo_bike', 'hamstrings', 'secondary'),
  ('echo_bike', 'glutes', 'secondary'),
  ('echo_bike', 'delt_front', 'secondary'),
  ('echo_bike', 'triceps', 'secondary'),
  ('bike_erg', 'quads', 'primary'),
  ('bike_erg', 'glutes', 'secondary'),
  ('bike_erg', 'calves', 'secondary'),
  ('bike_erg', 'hamstrings', 'secondary'),
  ('versaclimber', 'quads', 'primary'),
  ('versaclimber', 'glutes', 'primary'),
  ('versaclimber', 'delt_front', 'secondary'),
  ('versaclimber', 'lats', 'secondary'),
  ('versaclimber', 'calves', 'secondary')
on conflict (exercise_id, muscle_id) do update set role = excluded.role;

-- Técnica (pasos clave y errores típicos).
update public.exercises e set
  technique_steps = v.steps,
  technique_mistakes = v.mistakes
from (values
  ('stair_climber', array['Sube a la máquina con ella parada y elige un ritmo que puedas mantener hablando a medias.', 'Apoya todo el pie en cada escalón y empuja con el talón para que trabaje el glúteo.', 'Mantén el torso erguido; las manos rozan los pasamanos solo para no perder el equilibrio.']::text[], array['Colgarse de los pasamanos e inclinarse hacia delante: quita trabajo a las piernas.', 'Pisar solo con la punta del pie.', 'Empezar demasiado rápido y tener que parar a los pocos minutos.']::text[]),
  ('stationary_bike', array['Ajusta el sillín: con el pedal abajo, la rodilla queda ligeramente flexionada.', 'Coloca la parte delantera del pie sobre el pedal y aprieta las correas si las hay.', 'Pedalea redondo, empujando y tirando, con la cadera quieta sobre el sillín.', 'Sube la resistencia en vez de pedalear sin control a muchas revoluciones.']::text[], array['Sillín demasiado bajo: carga las rodillas.', 'Balancear la cadera de lado a lado.', 'Encorvar la espalda y cargar el peso en las manos.']::text[]),
  ('recumbent_bike', array['Ajusta el asiento para que, con el pedal lejos, la rodilla quede casi estirada.', 'Apoya la espalda y la cadera en el respaldo y sujeta las asas laterales.', 'Pedalea a un ritmo constante, empujando con todo el pie.']::text[], array['Asiento tan cerca que las rodillas suben hacia el pecho.', 'Bloquear la rodilla de golpe al estirar.', 'Separar la espalda del respaldo para empujar.']::text[]),
  ('treadmill_run', array['Ponte en los laterales, arranca la cinta despacio y entra caminando.', 'Pon un 1 % de inclinación para que se parezca más a correr fuera.', 'Corre en el centro de la cinta con pasos cortos, mirando al frente y con los brazos relajados.', 'Para bajar la velocidad poco a poco antes de salir; usa la pinza de seguridad.']::text[], array['Agarrarse a la barra delantera mientras se corre.', 'Zancada demasiado larga, aterrizando con el talón muy por delante del cuerpo.', 'Mirar los pies o la pantalla todo el rato.']::text[]),
  ('incline_walk', array['Empieza caminando en llano y sube la inclinación poco a poco (10–15 %).', 'Camina erguido, con pasos firmes y apoyando todo el pie.', 'Mueve los brazos con naturalidad; la velocidad es la que te permita no agarrarte.']::text[], array['Colgarse de los pasamanos: quita casi todo el trabajo.', 'Inclinarse mucho hacia delante desde la cintura.', 'Subir la inclinación de golpe sin calentar los gemelos.']::text[]),
  ('curved_treadmill', array['Sube sujetándote a los pasamanos y empieza a caminar en la parte baja de la curva.', 'Para acelerar, avanza hacia la parte delantera; para frenar, vuelve hacia atrás.', 'Corre sobre la parte delantera del pie con el torso ligeramente inclinado.']::text[], array['Pisar demasiado arriba de la curva y acelerar sin querer.', 'Aterrizar con el talón como en una cinta normal.', 'Bajar de golpe con la cinta todavía girando.']::text[]),
  ('elliptical', array['Sube con los pedales parados y coloca todo el pie en el centro de cada pedal.', 'Mantén el torso erguido y la mirada al frente.', 'Empuja y tira de las asas a la vez que mueves las piernas, con un ritmo constante.', 'Ajusta la resistencia para que no vayas solo a inercia.']::text[], array['Levantar los talones y empujar solo con las puntas.', 'Inclinarse sobre las asas fijas y apoyar el peso en ellas.', 'Resistencia tan baja que el pedal arrastra a las piernas.']::text[]),
  ('echo_bike', array['Ajusta el sillín para que la rodilla quede algo flexionada con el pedal abajo.', 'Coge las asas a la altura del pecho y empuja una mientras tiras de la otra.', 'Coordina brazos y piernas y mantén el core firme para no balancearte.', 'En los esprints, sube el ritmo poco a poco: la resistencia crece muy rápido.']::text[], array['Empezar a tope y quedarse vacío a los 20 segundos.', 'Usar solo las piernas y dejar los brazos muertos.', 'Sillín demasiado bajo.']::text[]),
  ('bike_erg', array['Ajusta sillín y manillar: rodilla casi estirada abajo y espalda neutra.', 'Elige un damper entre 3 y 6 para empezar.', 'Pedalea redondo y mira los vatios o el ritmo por 1000 m en la pantalla para mantenerlo.']::text[], array['Poner el damper al máximo pensando que trabaja más.', 'Botar sobre el sillín a cadencias muy altas.', 'Encorvar la espalda hacia el manillar.']::text[]),
  ('versaclimber', array['Ata los pies a los pedales y coge las asas a la altura de los hombros.', 'Sube un brazo a la vez que la pierna contraria, como al escalar.', 'Usa recorridos largos y un ritmo que puedas mantener; acelera acortando el recorrido.']::text[], array['Recorridos muy cortos y rápidos desde el principio.', 'Echar la cadera hacia atrás y alejarse de la máquina.', 'Tirar solo con los brazos.']::text[])
) as v (id, steps, mistakes)
where e.id = v.id and e.owner_id is null;

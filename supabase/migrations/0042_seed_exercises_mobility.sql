-- 0042_seed_exercises_mobility.sql
-- Semilla: movilidad y estiramientos (90/90, gato-camello, world's greatest stretch, couch stretch…) con su técnica. Requiere 0026.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.exercises (
  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,
  default_rest_s, technique_notes
) values
  ('hip_90_90', '90/90 de cadera', array['90 90', '90-90', '90/90 hip switch', 'hip 90 90', 'cambios 90/90', 'movilidad de cadera 90/90']::text[], 'mobility', 'reps', array['mat']::text[], false, false, 30, 'Sentado con las dos rodillas a 90°, gira las piernas de un lado a otro.'),
  ('cat_cow', 'Gato-camello', array['cat cow', 'cat-cow', 'gato vaca', 'cat camel', 'gato y vaca']::text[], 'mobility', 'reps', array['mat']::text[], false, false, 30, 'A cuatro patas, alterna redondear y arquear la espalda despacio con la respiración.'),
  ('worlds_greatest_stretch', 'World''s greatest stretch', array['worlds greatest stretch', 'el mejor estiramiento del mundo', 'spiderman con rotación', 'zancada con rotación']::text[], 'mobility', 'reps', array['bodyweight']::text[], true, true, 30, 'Zancada profunda, codo al suelo y rotación del tronco con el brazo hacia el techo.'),
  ('couch_stretch', 'Estiramiento de flexores de cadera (couch stretch)', array['couch stretch', 'hip flexor stretch', 'estiramiento de psoas', 'flexores de cadera', 'estiramiento de cuádriceps de rodillas']::text[], 'mobility', 'time', array['mat']::text[], true, false, 30, 'Rodilla trasera en el suelo cerca de la pared y empeine en ella; aprieta el glúteo.'),
  ('pigeon_stretch', 'Postura de la paloma', array['pigeon stretch', 'pigeon pose', 'paloma', 'estiramiento de glúteo en paloma', 'piriforme']::text[], 'mobility', 'time', array['mat']::text[], true, false, 30, 'Una pierna doblada delante y la otra estirada atrás; estira glúteo y cadera.'),
  ('open_book', 'Rotación torácica (libro abierto)', array['open book', 'thoracic rotation', 'rotación torácica', 'libro abierto', 't-spine rotation']::text[], 'mobility', 'reps', array['mat']::text[], true, false, 30, 'Tumbado de lado con las rodillas dobladas, abre el brazo de arriba como un libro.'),
  ('downward_dog', 'Perro boca abajo', array['downward dog', 'down dog', 'perro mirando abajo', 'v invertida', 'adho mukha']::text[], 'mobility', 'time', array['mat']::text[], false, false, 30, 'Cadera arriba y atrás, espalda larga y talones hacia el suelo.'),
  ('childs_pose', 'Postura del niño', array['child''s pose', 'childs pose', 'balasana', 'estiramiento de espalda de rodillas']::text[], 'mobility', 'time', array['mat']::text[], false, false, 30, 'De rodillas, glúteos a los talones y brazos estirados al frente; relaja la espalda.'),
  ('deep_squat_hold', 'Sentadilla profunda mantenida', array['deep squat hold', 'squat hold', 'sentadilla asiática', 'asian squat', 'cuclillas']::text[], 'mobility', 'time', array['bodyweight']::text[], false, false, 30, 'Abajo del todo con los talones apoyados; codos empujando las rodillas hacia fuera.'),
  ('knee_to_wall', 'Rodilla a la pared (movilidad de tobillo)', array['knee to wall', 'ankle dorsiflexion', 'movilidad de tobillo', 'dorsiflexión', 'ankle mobility']::text[], 'mobility', 'reps', array['bodyweight']::text[], true, false, 30, 'Pie a un palmo de la pared, lleva la rodilla a tocarla sin levantar el talón.'),
  ('shoulder_cars', 'CARs de hombro', array['shoulder cars', 'círculos de hombro', 'rotaciones controladas de hombro', 'controlled articular rotations']::text[], 'mobility', 'reps', array['bodyweight']::text[], true, false, 30, 'Círculos lentos y lo más amplios posible con el brazo estirado; el tronco no se mueve.'),
  ('hip_cars', 'CARs de cadera', array['hip cars', 'círculos de cadera', 'rotaciones controladas de cadera', 'hip circles']::text[], 'mobility', 'reps', array['bodyweight']::text[], true, false, 30, 'A cuatro patas o de pie, rodilla dibujando el círculo más amplio sin mover el tronco.'),
  ('hamstring_stretch', 'Estiramiento de isquiotibiales', array['hamstring stretch', 'estiramiento de isquios', 'isquios', 'estiramiento de femoral']::text[], 'mobility', 'time', array['mat', 'band']::text[], true, false, 30, 'Pierna estirada y espalda recta; inclínate desde la cadera, no doblando la espalda.'),
  ('cossack_squat', 'Sentadilla cosaca', array['cossack squat', 'cossack', 'sentadilla lateral profunda', 'sentadilla cossack']::text[], 'mobility', 'reps', array['bodyweight', 'kettlebell']::text[], false, true, 45, 'Pies muy abiertos: baja sobre una pierna con la otra estirada y la punta arriba.'),
  ('foam_rolling', 'Rodillo de espuma', array['foam roller', 'foam rolling', 'rodillo', 'automasaje', 'liberación miofascial', 'smr']::text[], 'mobility', 'duration_only', array['foam_roller']::text[], false, false, 30, 'Rueda despacio sobre el músculo y para en los puntos más cargados.'),
  ('cobra_stretch', 'Postura de la cobra', array['cobra', 'cobra stretch', 'cobra pose', 'extensión de espalda tumbado', 'bhujangasana']::text[], 'mobility', 'time', array['mat']::text[], false, false, 30, 'Boca abajo, empuja con las manos para levantar el pecho con la cadera en el suelo.'),
  ('frog_stretch', 'Estiramiento de la rana', array['frog stretch', 'rana', 'estiramiento de aductores', 'frog pose']::text[], 'mobility', 'time', array['mat']::text[], false, false, 30, 'A cuatro patas con las rodillas muy abiertas; lleva la cadera atrás despacio.'),
  ('wall_slide', 'Deslizamientos en pared', array['wall slides', 'wall angels', 'ángeles en la pared', 'deslizamiento de brazos en pared']::text[], 'mobility', 'reps', array['bodyweight']::text[], false, false, 30, 'Espalda y brazos contra la pared; sube y baja los brazos sin despegarlos.'),
  ('band_dislocates', 'Dislocaciones con goma o palo', array['band dislocates', 'shoulder dislocates', 'pass through', 'pase de palo', 'dislocaciones de hombro']::text[], 'mobility', 'reps', array['band']::text[], false, false, 30, 'Agarre ancho y brazos estirados: pasa la goma de delante a detrás por encima de la cabeza.'),
  ('thread_the_needle', 'Enhebrar la aguja', array['thread the needle', 'enhebrar aguja', 'rotación torácica a cuatro patas']::text[], 'mobility', 'reps', array['mat']::text[], true, false, 30, 'A cuatro patas, pasa un brazo por debajo del otro girando la espalda alta.')
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
delete from public.exercise_muscles where exercise_id in ('hip_90_90', 'cat_cow', 'worlds_greatest_stretch', 'couch_stretch', 'pigeon_stretch', 'open_book', 'downward_dog', 'childs_pose', 'deep_squat_hold', 'knee_to_wall', 'shoulder_cars', 'hip_cars', 'hamstring_stretch', 'cossack_squat', 'foam_rolling', 'cobra_stretch', 'frog_stretch', 'wall_slide', 'band_dislocates', 'thread_the_needle');

insert into public.exercise_muscles (exercise_id, muscle_id, role) values
  ('hip_90_90', 'glutes', 'primary'),
  ('hip_90_90', 'adductors', 'secondary'),
  ('cat_cow', 'lower_back', 'primary'),
  ('cat_cow', 'upper_back', 'secondary'),
  ('cat_cow', 'core', 'secondary'),
  ('worlds_greatest_stretch', 'glutes', 'primary'),
  ('worlds_greatest_stretch', 'hamstrings', 'primary'),
  ('worlds_greatest_stretch', 'adductors', 'secondary'),
  ('worlds_greatest_stretch', 'upper_back', 'secondary'),
  ('worlds_greatest_stretch', 'quads', 'secondary'),
  ('couch_stretch', 'quads', 'primary'),
  ('couch_stretch', 'core', 'secondary'),
  ('pigeon_stretch', 'glutes', 'primary'),
  ('pigeon_stretch', 'quads', 'secondary'),
  ('open_book', 'upper_back', 'primary'),
  ('open_book', 'chest', 'secondary'),
  ('downward_dog', 'hamstrings', 'primary'),
  ('downward_dog', 'calves', 'primary'),
  ('downward_dog', 'delt_front', 'secondary'),
  ('downward_dog', 'lats', 'secondary'),
  ('childs_pose', 'lower_back', 'primary'),
  ('childs_pose', 'lats', 'primary'),
  ('childs_pose', 'glutes', 'secondary'),
  ('deep_squat_hold', 'adductors', 'primary'),
  ('deep_squat_hold', 'glutes', 'primary'),
  ('deep_squat_hold', 'calves', 'secondary'),
  ('deep_squat_hold', 'lower_back', 'secondary'),
  ('knee_to_wall', 'calves', 'primary'),
  ('shoulder_cars', 'delt_front', 'primary'),
  ('shoulder_cars', 'delt_rear', 'primary'),
  ('shoulder_cars', 'delt_side', 'secondary'),
  ('shoulder_cars', 'upper_back', 'secondary'),
  ('hip_cars', 'glutes', 'primary'),
  ('hip_cars', 'adductors', 'secondary'),
  ('hip_cars', 'core', 'secondary'),
  ('hamstring_stretch', 'hamstrings', 'primary'),
  ('hamstring_stretch', 'calves', 'secondary'),
  ('cossack_squat', 'adductors', 'primary'),
  ('cossack_squat', 'quads', 'primary'),
  ('cossack_squat', 'glutes', 'secondary'),
  ('cossack_squat', 'hamstrings', 'secondary'),
  ('foam_rolling', 'quads', 'primary'),
  ('foam_rolling', 'hamstrings', 'primary'),
  ('foam_rolling', 'glutes', 'secondary'),
  ('foam_rolling', 'calves', 'secondary'),
  ('foam_rolling', 'lats', 'secondary'),
  ('cobra_stretch', 'core', 'primary'),
  ('cobra_stretch', 'lower_back', 'secondary'),
  ('frog_stretch', 'adductors', 'primary'),
  ('frog_stretch', 'glutes', 'secondary'),
  ('wall_slide', 'upper_back', 'primary'),
  ('wall_slide', 'delt_side', 'secondary'),
  ('wall_slide', 'delt_rear', 'secondary'),
  ('band_dislocates', 'delt_front', 'primary'),
  ('band_dislocates', 'chest', 'primary'),
  ('band_dislocates', 'delt_rear', 'secondary'),
  ('band_dislocates', 'upper_back', 'secondary'),
  ('thread_the_needle', 'upper_back', 'primary'),
  ('thread_the_needle', 'delt_rear', 'secondary')
on conflict (exercise_id, muscle_id) do update set role = excluded.role;

-- Técnica (pasos clave y errores típicos).
update public.exercises e set
  technique_steps = v.steps,
  technique_mistakes = v.mistakes
from (values
  ('hip_90_90', array['Siéntate con una pierna delante y otra al lado, las dos rodillas dobladas a 90°.', 'Mantén el torso erguido; apoya las manos detrás si lo necesitas.', 'Gira las dos rodillas a la vez hacia el otro lado sin despegar los talones.', 'Cuenta una repetición por cada cambio.']::text[], array['Encorvar la espalda.', 'Forzar con dolor en la rodilla.', 'Ir deprisa sin control.']::text[]),
  ('cat_cow', array['Ponte a cuatro patas con manos bajo hombros y rodillas bajo la cadera.', 'Al soltar el aire, redondea la espalda hacia el techo y mete la barbilla.', 'Al coger aire, arquea la espalda llevando el pecho adelante y la mirada al frente.', 'Mueve vértebra a vértebra, despacio.']::text[], array['Mover solo el cuello.', 'Ir rápido sin acompañar la respiración.', 'Forzar el arco lumbar.']::text[]),
  ('worlds_greatest_stretch', array['Da una zancada larga y apoya las manos en el suelo por dentro del pie delantero.', 'Baja el codo del mismo lado hacia el empeine.', 'Gira el tronco y lleva ese brazo hacia el techo siguiéndolo con la mirada.', 'Vuelve, estira la pierna delantera llevando la cadera atrás y cambia de lado.']::text[], array['Apoyar la rodilla trasera y perder la tensión.', 'Girar solo el brazo sin rotar el pecho.', 'Ir con rebote.']::text[]),
  ('couch_stretch', array['Arrodíllate de espaldas a una pared (o a un sofá) con la rodilla trasera cerca y el empeine apoyado arriba.', 'Adelanta la otra pierna con el pie en el suelo.', 'Sube el torso hasta quedar erguido y aprieta el glúteo de la pierna trasera.', 'Aguanta respirando y cambia de lado.']::text[], array['Arquear la lumbar en vez de meter la cadera.', 'Empezar demasiado cerca de la pared.', 'Rodilla sin protección sobre suelo duro.']::text[]),
  ('pigeon_stretch', array['Desde cuatro patas, lleva una rodilla delante entre las manos con la pierna doblada.', 'Estira la otra pierna hacia atrás con el empeine en el suelo.', 'Mantén la cadera recta y, si puedes, inclina el torso hacia delante.', 'Aguanta respirando y cambia de lado.']::text[], array['Dejar caer la cadera hacia un lado.', 'Forzar con dolor en la rodilla delantera (pon un cojín bajo la cadera).', 'Contener la respiración.']::text[]),
  ('open_book', array['Túmbate de lado con las rodillas dobladas a 90° y los brazos estirados al frente.', 'Abre el brazo de arriba hacia el otro lado siguiéndolo con la mirada.', 'Las rodillas siguen juntas y en el suelo; vuelve despacio.', 'Haz todas las repeticiones y cambia de lado.']::text[], array['Separar las rodillas al girar.', 'Forzar el hombro para tocar el suelo.', 'Ir deprisa.']::text[]),
  ('downward_dog', array['Desde cuatro patas, apoya los dedos de los pies y sube la cadera.', 'Empuja el suelo con las manos y lleva el pecho hacia los muslos.', 'Estira la espalda; dobla las rodillas si es necesario y lleva los talones hacia el suelo.']::text[], array['Redondear la espalda por estirar las piernas a la fuerza.', 'Encoger los hombros hacia las orejas.', 'Bloquear los codos hacia dentro.']::text[]),
  ('childs_pose', array['Arrodíllate con las rodillas algo separadas y los pies juntos.', 'Lleva los glúteos hacia los talones y estira los brazos al frente.', 'Apoya la frente y respira profundo notando cómo se abre la espalda.']::text[], array['Forzar las rodillas si molestan (pon un cojín).', 'Tensar los hombros.', 'Contener la respiración.']::text[]),
  ('deep_squat_hold', array['Pies algo más abiertos que los hombros y puntas hacia fuera.', 'Baja a la sentadilla más profunda que puedas con los talones en el suelo.', 'Junta las manos delante del pecho y empuja las rodillas hacia fuera con los codos.', 'Si se levantan los talones, agárrate a algo o pon un disco bajo ellos.']::text[], array['Levantar los talones.', 'Redondear mucho la espalda.', 'Rodillas hacia dentro.']::text[]),
  ('knee_to_wall', array['Ponte frente a una pared con un pie adelantado a unos centímetros de ella.', 'Lleva la rodilla hacia la pared sin despegar el talón.', 'Si toca fácil, aleja un poco el pie; si no, acércalo.', 'Haz las repeticiones y cambia de pierna.']::text[], array['Levantar el talón.', 'Llevar la rodilla hacia dentro.', 'Rebotar contra la pared.']::text[]),
  ('shoulder_cars', array['De pie, aprieta glúteos y abdomen para que el tronco no se mueva.', 'Con el brazo estirado, dibuja el círculo más grande que puedas, muy despacio.', 'Haz las repeticiones en un sentido y luego en el otro; cambia de brazo.']::text[], array['Arquear la espalda para llegar más lejos.', 'Ir rápido y sin control.', 'Doblar el codo.']::text[]),
  ('hip_cars', array['Ponte a cuatro patas (o de pie agarrado a algo) con el tronco firme.', 'Lleva una rodilla al pecho, ábrela al lado, gírala hacia atrás y vuelve.', 'Hazlo despacio y lo más amplio posible sin girar el tronco.', 'Repite en los dos sentidos y con las dos piernas.']::text[], array['Mover la espalda para compensar.', 'Círculos pequeños y rápidos.', 'Perder el equilibrio por no apoyarse.']::text[]),
  ('hamstring_stretch', array['Túmbate boca arriba con una goma o toalla en la planta de un pie.', 'Sube esa pierna estirada hasta notar un estiramiento suave detrás del muslo.', 'Mantén la otra pierna en el suelo y aguanta respirando.', 'Cambia de pierna.']::text[], array['Tirar hasta notar dolor.', 'Doblar la rodilla de la pierna estirada.', 'Levantar la cadera del suelo.']::text[]),
  ('cossack_squat', array['Abre mucho los pies con las puntas algo hacia fuera.', 'Baja hacia un lado doblando esa rodilla mientras la otra pierna se queda estirada con la punta arriba.', 'Mantén el talón de la pierna doblada en el suelo y el pecho alto.', 'Pasa al otro lado; cuenta una repetición por lado.']::text[], array['Levantar el talón de la pierna que baja.', 'Inclinar mucho el torso.', 'Forzar la profundidad con dolor en la ingle.']::text[]),
  ('foam_rolling', array['Coloca el rodillo bajo el músculo (cuádriceps, isquios, gemelos, dorsal…).', 'Apoya manos o pies para controlar cuánto peso cargas.', 'Rueda despacio de un extremo a otro y para unos segundos en los puntos cargados.', 'Dedica 30–60 s a cada zona.']::text[], array['Rodar sobre la zona lumbar o articulaciones.', 'Ir muy rápido.', 'Apretar hasta que duele mucho.']::text[]),
  ('cobra_stretch', array['Túmbate boca abajo con las manos bajo los hombros.', 'Empuja el suelo y levanta el pecho mientras la cadera sigue apoyada.', 'Hombros abajo y lejos de las orejas; aguanta respirando.']::text[], array['Levantar la cadera del suelo.', 'Encoger los hombros.', 'Forzar si molesta la zona lumbar.']::text[]),
  ('frog_stretch', array['A cuatro patas, separa las rodillas todo lo que puedas con los tobillos en línea con ellas.', 'Apoya los antebrazos en el suelo.', 'Lleva la cadera hacia atrás despacio hasta notar el estiramiento en la ingle y aguanta.']::text[], array['Rodillas sin protección en suelo duro.', 'Forzar con rebotes.', 'Arquear la lumbar.']::text[]),
  ('wall_slide', array['Apoya en la pared glúteos, espalda y cabeza, con los pies algo adelantados.', 'Pon los brazos en W contra la pared, con codos y dorso de las manos apoyados.', 'Desliza los brazos hacia arriba sin despegarlos y vuelve a bajar.']::text[], array['Arquear la lumbar para mantener los brazos pegados.', 'Despegar las manos de la pared.', 'Encoger los hombros al subir.']::text[]),
  ('band_dislocates', array['Coge una goma o un palo con agarre muy ancho y los brazos estirados delante.', 'Súbelos por encima de la cabeza y llévalos hasta detrás del cuerpo.', 'Vuelve por el mismo camino; estrecha el agarre poco a poco con los días.']::text[], array['Doblar los codos para pasar.', 'Agarre demasiado estrecho al empezar.', 'Arquear la lumbar.']::text[]),
  ('thread_the_needle', array['Ponte a cuatro patas con las manos bajo los hombros.', 'Pasa un brazo por debajo del otro hasta apoyar el hombro y la sien.', 'Vuelve y abre ese brazo hacia el techo girando el pecho.', 'Haz las repeticiones y cambia de lado.']::text[], array['Mover la cadera hacia los lados.', 'Girar solo el brazo.', 'Ir deprisa.']::text[])
) as v (id, steps, mistakes)
where e.id = v.id and e.owner_id is null;

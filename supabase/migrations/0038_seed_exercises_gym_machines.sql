-- 0038_seed_exercises_gym_machines.sql
-- Semilla: máquinas de gimnasio y poleas (hack squat, prensa inclinada, pec deck, remo sentado, abductores…) con su técnica. Requiere 0026.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.exercises (
  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,
  default_rest_s, technique_notes
) values
  ('hack_squat', 'Sentadilla hack', array['hack squat', 'hack', 'sentadilla en máquina hack', 'máquina hack']::text[], 'strength', 'weight_reps', array['machine']::text[], false, true, 150, 'Espalda apoyada en el respaldo, pies en el centro y bajar hasta 90° o algo más.'),
  ('incline_leg_press', 'Prensa inclinada 45°', array['incline leg press', 'prensa 45', 'prensa de 45 grados', 'leg press 45', 'prensa inclinada']::text[], 'strength', 'weight_reps', array['machine']::text[], false, true, 150, 'Cadera pegada al respaldo, bajar hasta 90° de rodilla y empujar sin bloquear.'),
  ('smith_squat', 'Sentadilla en multipower', array['smith machine squat', 'sentadilla smith', 'multipower', 'sentadilla en smith', 'sentadilla guiada']::text[], 'strength', 'weight_reps', array['smith']::text[], false, true, 150, 'Barra guiada en la espalda alta, pies algo adelantados y bajar con el torso firme.'),
  ('pec_deck', 'Contractor de pecho (pec deck)', array['pec deck', 'peck deck', 'butterfly', 'aperturas en máquina', 'máquina de aperturas', 'contractor', 'chest fly machine']::text[], 'strength', 'weight_reps', array['machine']::text[], false, false, 75, 'Codos algo flexionados a la altura del pecho; junta los brazos sin encoger hombros.'),
  ('reverse_pec_deck', 'Pájaro en máquina (pec deck inverso)', array['reverse pec deck', 'reverse fly machine', 'pájaros en máquina', 'deltoides posterior en máquina', 'rear delt machine']::text[], 'strength', 'weight_reps', array['machine']::text[], false, false, 60, 'Sentado mirando a la máquina, abre los brazos casi estirados hacia atrás.'),
  ('chest_press_machine', 'Press de pecho en máquina', array['chest press', 'machine chest press', 'press en máquina', 'press banca en máquina', 'press horizontal en máquina']::text[], 'strength', 'weight_reps', array['machine']::text[], false, true, 90, 'Agarres a la altura del pecho, hombros atrás y empuje sin bloquear los codos.'),
  ('shoulder_press_machine', 'Press de hombro en máquina', array['machine shoulder press', 'shoulder press', 'press militar en máquina', 'press de hombros sentado en máquina']::text[], 'strength', 'weight_reps', array['machine']::text[], false, true, 90, 'Agarres a la altura de los hombros, espalda apoyada y empujar hacia arriba.'),
  ('seated_cable_row', 'Remo sentado en polea', array['seated cable row', 'remo en polea baja', 'remo gironda', 'low row', 'cable row', 'remo con triángulo']::text[], 'strength', 'weight_reps', array['cable']::text[], false, true, 90, 'Torso erguido y quieto; tira llevando los codos atrás y junta los omóplatos.'),
  ('machine_row', 'Remo en máquina', array['machine row', 'remo sentado en máquina', 'chest supported row', 'remo con pecho apoyado']::text[], 'strength', 'weight_reps', array['machine']::text[], false, true, 90, 'Pecho apoyado en el respaldo; tira de los codos hacia atrás sin despegarte.'),
  ('close_grip_pulldown', 'Jalón agarre estrecho', array['close grip pulldown', 'jalón con triángulo', 'jalón neutro', 'v-bar pulldown', 'jalón estrecho']::text[], 'strength', 'weight_reps', array['cable', 'machine']::text[], false, true, 90, 'Agarre estrecho o neutro; baja al pecho llevando los codos hacia las costillas.'),
  ('straight_arm_pulldown', 'Pullover en polea (brazos rectos)', array['straight arm pulldown', 'straight-arm pulldown', 'pullover en polea', 'jalón con brazos rectos']::text[], 'strength', 'weight_reps', array['cable']::text[], false, false, 60, 'Brazos casi rectos: baja la barra o la cuerda hasta los muslos con el dorsal.'),
  ('assisted_pull_up', 'Dominada asistida', array['assisted pull-up', 'dominadas asistidas', 'gravitron', 'dominada con goma', 'band assisted pull-up']::text[], 'strength', 'reps', array['machine', 'band', 'pullup_bar']::text[], false, true, 120, 'La máquina o la goma te ayudan: más ayuda, más fácil. Anota la ayuda en notas.'),
  ('hip_abduction_machine', 'Máquina de abductores', array['hip abduction', 'abductores', 'abducción de cadera', 'abductor machine', 'máquina de abducción']::text[], 'strength', 'weight_reps', array['machine']::text[], false, false, 60, 'Sentado, abre las piernas contra las almohadillas: trabaja el glúteo medio.'),
  ('hip_adduction_machine', 'Máquina de aductores', array['hip adduction', 'aductores', 'aducción de cadera', 'adductor machine', 'máquina de aducción']::text[], 'strength', 'weight_reps', array['machine']::text[], false, false, 60, 'Sentado, cierra las piernas contra las almohadillas internas.'),
  ('seated_calf_raise', 'Elevación de gemelos sentado', array['seated calf raise', 'gemelos sentado', 'sóleo', 'máquina de gemelos sentado']::text[], 'strength', 'weight_reps', array['machine']::text[], false, false, 60, 'Rodillas dobladas a 90°: trabaja sobre todo el sóleo. Recorrido completo.'),
  ('back_extension', 'Extensión lumbar (banco a 45°)', array['back extension', 'hiperextensiones', 'hyperextension', 'banco romano', 'extensiones lumbares', 'lumbares']::text[], 'strength', 'weight_reps', array['machine', 'bench']::text[], false, true, 90, 'Cadera en el borde del apoyo; baja con la espalda neutra y sube hasta alinear el cuerpo.'),
  ('glute_kickback', 'Patada de glúteo en polea o máquina', array['glute kickback', 'cable kickback', 'patada de glúteo', 'patada trasera', 'kickback de glúteo']::text[], 'strength', 'weight_reps', array['cable', 'machine']::text[], true, false, 60, 'Lleva la pierna atrás apretando el glúteo sin arquear la lumbar.'),
  ('cable_fly', 'Cruce de poleas', array['cable crossover', 'cable fly', 'aperturas en polea', 'cruces', 'crossover']::text[], 'strength', 'weight_reps', array['cable']::text[], false, false, 60, 'Un paso adelante, codos algo flexionados y junta las manos delante del pecho.'),
  ('preacher_curl', 'Curl predicador (banco Scott)', array['preacher curl', 'curl scott', 'banco scott', 'curl en banco scott', 'curl predicador']::text[], 'strength', 'weight_reps', array['barbell', 'dumbbell', 'ez_bar', 'machine']::text[], false, false, 75, 'Brazos apoyados en el banco: sube sin despegar los codos y baja casi hasta estirar.'),
  ('t_bar_row', 'Remo en T', array['t-bar row', 't bar row', 'remo en punta', 'remo landmine', 'remo con barra en t']::text[], 'strength', 'weight_reps', array['landmine', 'barbell', 'machine']::text[], false, true, 120, 'Torso inclinado y espalda neutra; tira del agarre hacia el abdomen.'),
  ('cable_overhead_triceps', 'Extensión de tríceps sobre la cabeza en polea', array['overhead cable triceps extension', 'cable overhead extension', 'extensión de tríceps tras nuca en polea', 'francés en polea']::text[], 'strength', 'weight_reps', array['cable']::text[], false, false, 60, 'De espaldas a la polea, cuerda tras la cabeza y estira los codos hacia delante.')
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
delete from public.exercise_muscles where exercise_id in ('hack_squat', 'incline_leg_press', 'smith_squat', 'pec_deck', 'reverse_pec_deck', 'chest_press_machine', 'shoulder_press_machine', 'seated_cable_row', 'machine_row', 'close_grip_pulldown', 'straight_arm_pulldown', 'assisted_pull_up', 'hip_abduction_machine', 'hip_adduction_machine', 'seated_calf_raise', 'back_extension', 'glute_kickback', 'cable_fly', 'preacher_curl', 't_bar_row', 'cable_overhead_triceps');

insert into public.exercise_muscles (exercise_id, muscle_id, role) values
  ('hack_squat', 'quads', 'primary'),
  ('hack_squat', 'glutes', 'primary'),
  ('hack_squat', 'adductors', 'secondary'),
  ('incline_leg_press', 'quads', 'primary'),
  ('incline_leg_press', 'glutes', 'primary'),
  ('incline_leg_press', 'adductors', 'secondary'),
  ('incline_leg_press', 'hamstrings', 'secondary'),
  ('smith_squat', 'quads', 'primary'),
  ('smith_squat', 'glutes', 'primary'),
  ('smith_squat', 'adductors', 'secondary'),
  ('smith_squat', 'core', 'secondary'),
  ('pec_deck', 'chest', 'primary'),
  ('pec_deck', 'delt_front', 'secondary'),
  ('reverse_pec_deck', 'delt_rear', 'primary'),
  ('reverse_pec_deck', 'upper_back', 'secondary'),
  ('chest_press_machine', 'chest', 'primary'),
  ('chest_press_machine', 'triceps', 'secondary'),
  ('chest_press_machine', 'delt_front', 'secondary'),
  ('shoulder_press_machine', 'delt_front', 'primary'),
  ('shoulder_press_machine', 'delt_side', 'secondary'),
  ('shoulder_press_machine', 'triceps', 'secondary'),
  ('seated_cable_row', 'upper_back', 'primary'),
  ('seated_cable_row', 'lats', 'primary'),
  ('seated_cable_row', 'biceps', 'secondary'),
  ('seated_cable_row', 'delt_rear', 'secondary'),
  ('machine_row', 'upper_back', 'primary'),
  ('machine_row', 'lats', 'primary'),
  ('machine_row', 'biceps', 'secondary'),
  ('machine_row', 'delt_rear', 'secondary'),
  ('close_grip_pulldown', 'lats', 'primary'),
  ('close_grip_pulldown', 'biceps', 'secondary'),
  ('close_grip_pulldown', 'upper_back', 'secondary'),
  ('straight_arm_pulldown', 'lats', 'primary'),
  ('straight_arm_pulldown', 'triceps', 'secondary'),
  ('straight_arm_pulldown', 'core', 'secondary'),
  ('assisted_pull_up', 'lats', 'primary'),
  ('assisted_pull_up', 'biceps', 'secondary'),
  ('assisted_pull_up', 'upper_back', 'secondary'),
  ('hip_abduction_machine', 'glutes', 'primary'),
  ('hip_adduction_machine', 'adductors', 'primary'),
  ('seated_calf_raise', 'calves', 'primary'),
  ('back_extension', 'lower_back', 'primary'),
  ('back_extension', 'glutes', 'primary'),
  ('back_extension', 'hamstrings', 'secondary'),
  ('glute_kickback', 'glutes', 'primary'),
  ('glute_kickback', 'hamstrings', 'secondary'),
  ('cable_fly', 'chest', 'primary'),
  ('cable_fly', 'delt_front', 'secondary'),
  ('preacher_curl', 'biceps', 'primary'),
  ('preacher_curl', 'forearms', 'secondary'),
  ('t_bar_row', 'upper_back', 'primary'),
  ('t_bar_row', 'lats', 'primary'),
  ('t_bar_row', 'biceps', 'secondary'),
  ('t_bar_row', 'delt_rear', 'secondary'),
  ('t_bar_row', 'lower_back', 'secondary'),
  ('cable_overhead_triceps', 'triceps', 'primary')
on conflict (exercise_id, muscle_id) do update set role = excluded.role;

-- Técnica (pasos clave y errores típicos).
update public.exercises e set
  technique_steps = v.steps,
  technique_mistakes = v.mistakes
from (values
  ('hack_squat', array['Colócate con la espalda y los hombros bien apoyados en las almohadillas.', 'Pies en el centro de la plataforma, a la anchura de la cadera.', 'Quita los seguros y baja controlando hasta que los muslos pasen de paralelo si tu movilidad lo permite.', 'Sube empujando con todo el pie sin bloquear las rodillas arriba.']::text[], array['Despegar los talones de la plataforma.', 'Rodillas que se van hacia dentro.', 'Bloquear las rodillas de golpe arriba.']::text[]),
  ('incline_leg_press', array['Siéntate con la espalda y la cadera bien apoyadas en el respaldo.', 'Pies a la anchura de la cadera en el centro de la plataforma; más arriba trabaja más el glúteo.', 'Quita los seguros y baja despacio hasta unos 90° de rodilla, sin que se levante la cadera.', 'Empuja con todo el pie hasta casi estirar y vuelve a bajar controlando.']::text[], array['Bajar tanto que la cadera se despega y la lumbar se redondea.', 'Bloquear las rodillas arriba.', 'Poner las manos en las rodillas para empujar.']::text[]),
  ('smith_squat', array['Colócate bajo la barra con ella apoyada en la parte alta de la espalda.', 'Adelanta un poco los pies respecto a la barra, a la anchura de los hombros.', 'Desbloquea girando la barra y baja hasta paralelo con el pecho alto.', 'Sube empujando el suelo y vuelve a bloquear la barra al terminar.']::text[], array['Pies justo debajo de la barra: carga mucho las rodillas.', 'Olvidar bloquear la barra al acabar.', 'Redondear la lumbar abajo.']::text[]),
  ('pec_deck', array['Ajusta el asiento para que los agarres queden a la altura del pecho.', 'Apoya la espalda, saca pecho y lleva los hombros atrás.', 'Junta los brazos delante del pecho con los codos ligeramente doblados.', 'Vuelve despacio hasta notar el estiramiento sin pasar de la línea de los hombros.']::text[], array['Despegar la espalda y encorvarse al cerrar.', 'Abrir tanto que los hombros sufren.', 'Dejar que el peso choque al volver.']::text[]),
  ('reverse_pec_deck', array['Siéntate mirando al respaldo con el pecho apoyado y los agarres a la altura de los hombros.', 'Con los brazos casi estirados, ábrelos hacia atrás en un arco.', 'Aprieta un segundo atrás y vuelve despacio.']::text[], array['Encoger los hombros hacia las orejas.', 'Doblar los codos y convertirlo en un remo.', 'Despegar el pecho del respaldo para tirar.']::text[]),
  ('chest_press_machine', array['Ajusta el asiento para que los agarres queden a la altura de la mitad del pecho.', 'Apoya la espalda y junta los omóplatos.', 'Empuja hacia delante hasta casi estirar los brazos.', 'Vuelve despacio hasta notar el estiramiento en el pecho.']::text[], array['Asiento demasiado bajo o alto: empujan los hombros.', 'Despegar la espalda del respaldo.', 'Bloquear los codos de golpe.']::text[]),
  ('shoulder_press_machine', array['Ajusta el asiento para que los agarres queden a la altura de los hombros.', 'Apoya la espalda en el respaldo y aprieta el abdomen.', 'Empuja hacia arriba hasta casi estirar los brazos y baja controlando.']::text[], array['Arquear la lumbar para empujar.', 'Bajar poco el recorrido.', 'Encoger los hombros arriba.']::text[]),
  ('seated_cable_row', array['Siéntate con los pies en los apoyos y las rodillas algo flexionadas.', 'Coge el agarre con la espalda recta y el pecho alto.', 'Tira hacia el abdomen llevando los codos atrás y juntando los omóplatos.', 'Vuelve estirando los brazos sin dejar que el torso se vaya adelante.']::text[], array['Balancear el torso adelante y atrás para mover el peso.', 'Redondear la espalda al estirar.', 'Encoger los hombros al tirar.']::text[]),
  ('machine_row', array['Ajusta el asiento y el apoyo para que los agarres queden a la altura del pecho.', 'Apoya el pecho y coge los agarres con los brazos estirados.', 'Tira llevando los codos atrás y aprieta la espalda un segundo.', 'Vuelve despacio hasta estirar los brazos.']::text[], array['Despegar el pecho del apoyo para tirar con la espalda baja.', 'Encoger los hombros.', 'Recorrido corto.']::text[]),
  ('close_grip_pulldown', array['Siéntate con las rodillas bajo los rodillos y coge el triángulo o una barra estrecha.', 'Inclina un poco el torso hacia atrás y saca pecho.', 'Tira hacia la parte alta del pecho llevando los codos hacia abajo y pegados.', 'Sube estirando los brazos del todo y controlando.']::text[], array['Echarse muy atrás y convertirlo en un remo.', 'Tirar con los brazos sin bajar los hombros.', 'Soltar el peso de golpe arriba.']::text[]),
  ('straight_arm_pulldown', array['De pie frente a la polea alta, coge la barra o la cuerda con los brazos casi estirados.', 'Inclina un poco el torso hacia delante con la espalda recta.', 'Baja los brazos en arco hasta los muslos sin doblar los codos.', 'Sube despacio hasta la altura de la cabeza.']::text[], array['Doblar los codos y empujar como un tríceps.', 'Mover el torso para ayudarse.', 'Subir tanto que los hombros se encogen.']::text[]),
  ('assisted_pull_up', array['Elige la ayuda (contrapeso o goma) que te deje hacer las repeticiones con buena técnica.', 'Cuélgate con agarre algo más ancho que los hombros y los hombros activos.', 'Sube llevando el pecho a la barra y los codos hacia las costillas.', 'Baja despacio hasta estirar los brazos.']::text[], array['Tanta ayuda que no cuesta nada.', 'Medio recorrido sin estirar los brazos abajo.', 'Balancearse para subir.']::text[]),
  ('hip_abduction_machine', array['Siéntate con la espalda apoyada y las almohadillas por fuera de las rodillas.', 'Abre las piernas empujando hacia fuera con control.', 'Aguanta un segundo abierto y vuelve despacio sin que choque el peso.']::text[], array['Despegar la espalda y balancearse.', 'Volver de golpe.', 'Recorrido muy corto con demasiado peso.']::text[]),
  ('hip_adduction_machine', array['Ajusta la apertura para notar un estiramiento suave, sin dolor.', 'Apoya la espalda y coloca las almohadillas por dentro de las rodillas.', 'Junta las piernas con control y vuelve despacio.']::text[], array['Empezar con demasiada apertura y forzar la ingle.', 'Cerrar de golpe.', 'Balancear el cuerpo.']::text[]),
  ('seated_calf_raise', array['Siéntate con la almohadilla sobre los muslos, cerca de las rodillas.', 'Apoya la parte delantera del pie en el escalón con los talones en el aire.', 'Baja los talones todo lo que puedas y sube hasta ponerte de puntillas.', 'Aguanta un segundo arriba y baja despacio.']::text[], array['Rebotar abajo.', 'Medio recorrido.', 'Empujar con las manos sobre la almohadilla.']::text[]),
  ('back_extension', array['Ajusta el apoyo para que quede justo por debajo de la cadera y engancha los tobillos.', 'Cruza los brazos en el pecho (o sujeta un disco) con la espalda recta.', 'Baja doblando la cadera hasta notar los isquios.', 'Sube apretando glúteos hasta que el cuerpo quede en línea, sin pasarte.']::text[], array['Subir por encima de la línea del cuerpo y arquear la lumbar.', 'Hacerlo con rebote.', 'Apoyo demasiado alto que bloquea la cadera.']::text[]),
  ('glute_kickback', array['Engancha la tobillera a la polea baja (o colócate en la máquina).', 'Inclina un poco el torso y sujétate con las manos.', 'Lleva la pierna atrás apretando el glúteo, con la rodilla casi estirada.', 'Vuelve despacio y haz todas las repeticiones antes de cambiar.']::text[], array['Arquear la lumbar para subir más la pierna.', 'Balancear la pierna con impulso.', 'Girar la cadera hacia fuera.']::text[]),
  ('cable_fly', array['Coloca las poleas a la altura de los hombros (o más altas) y coge un agarre en cada mano.', 'Da un paso adelante con el pecho alto y los codos ligeramente flexionados.', 'Junta las manos delante del pecho en un arco amplio.', 'Vuelve despacio hasta notar el estiramiento sin llevar los brazos muy atrás.']::text[], array['Doblar mucho los codos y convertirlo en un press.', 'Encorvarse hacia delante al cerrar.', 'Abrir demasiado y forzar el hombro.']::text[]),
  ('preacher_curl', array['Ajusta el asiento para que las axilas queden sobre el borde del apoyo.', 'Coge la barra con las palmas arriba y los brazos apoyados.', 'Sube flexionando los codos sin despegarlos del apoyo.', 'Baja despacio casi hasta estirar, sin bloquear del todo.']::text[], array['Dejar caer el peso abajo con el codo bloqueado.', 'Levantar los codos del apoyo.', 'Echar el cuerpo atrás para subir.']::text[]),
  ('t_bar_row', array['Colócate a horcajadas sobre la barra con el agarre en V bajo el pecho.', 'Inclina el torso unos 45° con la espalda recta y las rodillas algo flexionadas.', 'Tira hacia el abdomen llevando los codos atrás y juntando los omóplatos.', 'Baja controlando hasta estirar los brazos.']::text[], array['Redondear la espalda.', 'Levantar el torso en cada repetición para mover más peso.', 'Tirar solo con los brazos.']::text[]),
  ('cable_overhead_triceps', array['De espaldas a la polea, coge la cuerda por encima de la cabeza con los codos doblados.', 'Da un paso adelante y aprieta el abdomen.', 'Estira los codos hacia delante y arriba sin moverlos de sitio.', 'Vuelve despacio hasta notar el estiramiento del tríceps.']::text[], array['Abrir mucho los codos hacia fuera.', 'Arquear la lumbar.', 'Mover los hombros en vez de los codos.']::text[])
) as v (id, steps, mistakes)
where e.id = v.id and e.owner_id is null;

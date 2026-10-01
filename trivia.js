/* ============================================
   TRIVIA VERDE — minijuego en ventana emergente
   - Se abre desde "Trivia" en el encabezado (o el botón flotante en celulares).
   - Al terminar: guardar puntos (mejor puntaje en usuarios.puntos_trivia),
     puesto en el ranking y top 5 con "Ver más".
   Autocontenido: no modifica script.js. Solo lee Store.usuario y usa
   abrirModalLogin() cuando hace falta iniciar sesión.
============================================ */
(function () {
  'use strict';

  const TIEMPO = 15;        // segundos por pregunta
  const VIDAS = 3;
  const POR_PARTIDA = 10;   // preguntas por partida

  // La primera opción de cada pregunta es la correcta (se mezclan al mostrar).
  const PREGUNTAS = [
    { q: '¿Cuánto tarda en degradarse una botella de plástico?', a: ['Unos 450 años', 'Unos 5 años', 'Unos 20 años', 'Menos de 1 año'], e: 'El plástico PET puede tardar siglos y se rompe en microplásticos que nunca desaparecen del todo.' },
    { q: 'En la Ciudad de Buenos Aires, ¿qué va en el contenedor verde?', a: ['Reciclables secos (papel, cartón, plástico, vidrio, metal)', 'Restos de comida', 'Pilas y baterías', 'Aceite de cocina usado'], e: 'El verde es para reciclables secos y limpios. Los restos de comida y lo no reciclable van al contenedor negro.' },
    { q: '¿Qué gas aporta más al calentamiento global por la actividad humana?', a: ['Dióxido de carbono (CO₂)', 'Oxígeno', 'Nitrógeno', 'Helio'], e: 'El CO₂ sale sobre todo de quemar petróleo, gas y carbón, y de la deforestación.' },
    { q: '¿Cuál de estas fuentes de energía es renovable?', a: ['La solar', 'El carbón', 'El petróleo', 'El gas natural'], e: 'El sol, el viento y el agua se reponen de forma natural. Los combustibles fósiles tardan millones de años.' },
    { q: '¿Qué es el compostaje?', a: ['Convertir residuos orgánicos en abono', 'Quemar la basura', 'Enterrar plástico', 'Lavar envases'], e: 'Cáscaras, hojas y restos de comida se descomponen y se transforman en tierra fértil.' },
    { q: '¿Cuál de estos animales está en peligro crítico en Argentina?', a: ['El yaguareté', 'El hornero', 'La vizcacha', 'El carpincho'], e: 'Quedan muy pocos yaguaretés en el país. Los otros tres tienen poblaciones estables.' },
    { q: '¿Qué material se puede reciclar muchas veces sin perder calidad?', a: ['El vidrio', 'El telgopor', 'El papel higiénico', 'Los envases de golosinas'], e: 'El vidrio se funde y se reforma una y otra vez con la misma calidad.' },
    { q: '¿Qué porcentaje del agua del planeta es agua dulce?', a: ['Menos del 3 %', '15 %', '30 %', '50 %'], e: 'Casi toda el agua es salada, y gran parte de la dulce está congelada en glaciares.' },
    { q: '¿Por qué no hay que tirar las pilas a la basura común?', a: ['Tienen metales pesados que contaminan suelo y agua', 'Se pueden inflamar con la lluvia', 'Ocupan mucho espacio', 'Atraen insectos'], e: 'Llevalas a un punto de recolección de pilas.' },
    { q: '¿Qué capa de la atmósfera nos protege de los rayos ultravioleta?', a: ['La capa de ozono', 'La troposfera', 'La ionosfera', 'La capa de nubes'], e: 'El ozono filtra gran parte de la radiación UV dañina.' },
    { q: 'Para un trayecto corto, ¿qué medio emite menos CO₂ por persona?', a: ['La bicicleta', 'El auto', 'La moto', 'El taxi'], e: 'Pedalear no emite CO₂ y además mejora la salud.' },
    { q: '¿Cuándo se celebra el Día Mundial del Medio Ambiente?', a: ['5 de junio', '22 de abril', '21 de marzo', '1 de enero'], e: 'Es el 5 de junio. El 22 de abril es el Día de la Tierra.' },
    { q: '¿Cuántos m² de espacio verde por habitante recomienda la OMS?', a: ['9 m²', '2 m²', '20 m²', '50 m²'], e: 'San Telmo tiene apenas 1,8 m² por habitante, muy lejos de esa meta.' },
    { q: '¿Qué es una isla de calor urbana?', a: ['Una zona de la ciudad más caliente que su entorno por el cemento y la falta de árboles', 'Un parque con clima tropical', 'Una isla en el Río de la Plata', 'Un techo con paneles solares'], e: 'El asfalto y el cemento acumulan calor, mientras que los árboles dan sombra y refrescan el aire.' },
    { q: '¿Qué es una plaza de bolsillo?', a: ['Un espacio verde pequeño en un terreno reducido de la ciudad', 'Una plaza que solo abre de noche', 'Una plaza sin árboles', 'Un estacionamiento con macetas'], e: 'Son plazas chicas que transforman lotes vacíos o esquinas en lugares de encuentro con verde.' },
    { q: '¿Cuál de estos materiales tarda más en degradarse?', a: ['El telgopor (poliestireno expandido)', 'Una cáscara de banana', 'Una hoja de papel sin recubrimiento', 'Un resto de poda'], e: 'El telgopor puede tardar cientos de años y encima se rompe en pedacitos que contaminan más.' },
    { q: '¿Qué significa la "regla de las 3R" del cuidado ambiental?', a: ['Reducir, Reutilizar, Reciclar', 'Reducir, Reparar, Renovar', 'Reciclar, Remover, Reponer', 'Reutilizar, Rebajar, Renovar'], e: 'En ese orden de prioridad: primero generar menos residuos, después darles una segunda vida, y recién al final reciclar.' },
    { q: 'De estos dos gases de efecto invernadero, ¿cuál es más potente por molécula aunque dura menos tiempo en la atmósfera?', a: ['El metano (CH₄)', 'El dióxido de carbono (CO₂)', 'El oxígeno', 'El nitrógeno'], e: 'El metano atrapa mucho más calor por molécula que el CO₂, pero se degrada en la atmósfera en décadas en vez de siglos.' },
    { q: '¿Qué problema ambiental causa principalmente el agujero en la capa de ozono?', a: ['Deja pasar más radiación ultravioleta dañina', 'Es la causa principal del calentamiento global', 'Produce lluvia ácida', 'Contamina las napas de agua'], e: 'Es un error común: el agujero de ozono y el calentamiento global son dos problemas distintos, con causas diferentes.' },
    { q: '¿Qué día se conmemora el "Día de la Tierra"?', a: ['22 de abril', '5 de junio', '16 de septiembre', '1 de junio'], e: 'El 5 de junio es el Día Mundial del Medio Ambiente, y el 16 de septiembre es el Día de la Capa de Ozono: son fechas distintas.' },
    { q: '¿Qué número lleva el triángulo de reciclaje en una botella de gaseosa común (PET)?', a: ['1', '2', '5', '7'], e: 'El PET es el plástico número 1. Cada número indica un tipo de resina distinto, no todos se reciclan igual.' },
    { q: '¿Cuál de estas acciones ahorra más agua en una casa?', a: ['Cerrar la canilla mientras te cepillás los dientes', 'Dejar la canilla abierta mientras enjabonás los platos', 'Regar las plantas al mediodía', 'Llenar la bañera hasta el tope'], e: 'Parece un gesto chico, pero una canilla abierta sin necesidad puede gastar varios litros por minuto.' },
    { q: 'Aproximadamente, ¿cuánta agua hace falta para producir 1 kg de carne vacuna (su "huella hídrica")?', a: ['Más de 15.000 litros', 'Unos 500 litros', 'Unos 50 litros', 'Unos 2.000 litros'], e: 'La ganadería es una de las actividades que más agua consume de forma indirecta, por el agua usada para producir el alimento del animal.' },
    { q: 'Al viajar solo, ¿qué medio de transporte emite menos CO₂ por pasajero frente al auto particular?', a: ['El tren o subte eléctrico', 'La moto', 'El taxi', 'El auto compartido con una sola persona'], e: 'El transporte eléctrico de alta capacidad reparte la energía entre muchos pasajeros a la vez, lo que baja mucho la emisión por persona.' },
    { q: '¿De dónde proviene gran parte de los microplásticos que terminan en el mar?', a: ['Del lavado de ropa sintética y la degradación de plásticos más grandes', 'Exclusivamente de los barcos pesqueros', 'De erupciones volcánicas', 'De la lluvia ácida'], e: 'Cada lavado de ropa sintética libera fibras microscópicas que las plantas de tratamiento no siempre logran filtrar.' }
  ];

  const modal = document.getElementById('modalTrivia');
  const root = document.getElementById('triviaApp');
  if (!modal || !root) return;

  let S = null;              // estado de la partida (null = pantalla de inicio)
  let timer = null;
  let ultimoFoco = null;     // para devolver el foco al cerrar
  let refrescarFin = null;   // se llama si el usuario inicia/cierra sesión en la pantalla final

  // Colores del tema (coinciden con las variables CSS --verde-claro/--oro/--rojo-calor)
  const COLOR_VERDE = [116, 198, 157];
  const COLOR_AMARILLO = [200, 148, 10];
  const COLOR_ROJO = [192, 57, 43];

  function mezclar(c1, c2, t) {
    return c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  }

  // frac: 1 = tiempo lleno (verde) → 0.5 = mitad (amarillo) → 0 = se acaba (rojo)
  function colorBarra(frac) {
    const f = Math.max(0, Math.min(1, frac));
    const [r, g, b] = f >= 0.5
      ? mezclar(COLOR_AMARILLO, COLOR_VERDE, (f - 0.5) * 2)
      : mezclar(COLOR_ROJO, COLOR_AMARILLO, f * 2);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Convierte segundos a "m:ss" para mostrar el tiempo total de una partida
  function formatoTiempo(segundos) {
    const s = Math.max(0, Math.round(segundos));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function btn(texto, onClick, cls) {
    const b = el('button', cls || 'btn-primary', texto);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  const detenerTimer = () => clearInterval(timer);

  /* ---------- usuario y API ---------- */
  function usuarioActual() {
    try { return (typeof Store !== 'undefined' && Store.usuario) || null; } catch (e) { return null; }
  }

  // Mismos datos con los que el resto de la app identifica al usuario en el servidor
  function identidad() {
    const u = usuarioActual();
    const d = {};
    if (!u) return d;
    if (u.id != null && u.id !== '') d.usuario_id = String(u.id);
    if (u.email) d.email = u.email;
    if (u.google_id) d.google_id = u.google_id;
    return d;
  }

  async function api(url, opciones) {
    const r = await fetch(url, opciones);
    let datos = {};
    try { datos = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error(datos.error || 'Error ' + r.status);
    return datos;
  }

  /* ---------- ranking (top 5 + "Ver más") ---------- */
  function crearRanking() {
    const wrap = el('div', 'tv-rank');
    let verTodos = false;

    async function pintar() {
      wrap.replaceChildren(el('p', 'tv-nota', 'Cargando ranking…'));
      try {
        const qs = new URLSearchParams(Object.assign({ limite: verTodos ? 'todos' : '5' }, identidad()));
        const d = await api('/api/trivia/ranking?' + qs.toString());
        if (!root.contains(wrap)) return; // la pantalla ya cambió

        wrap.replaceChildren(el('h4', '', verTodos ? 'Ranking completo' : 'Top 5 jugadores'));
        if (!d.ranking.length) {
          wrap.appendChild(el('p', 'tv-nota', 'Todavía nadie guardó puntos. ¡Podés ser el primero!'));
          return;
        }
        const ol = el('ol');
        d.ranking.forEach((r) => {
          const li = el('li', r.tu ? 'tu' : '');
          li.append(
            el('span', 'pos', '#' + r.posicion),
            el('span', 'nom', r.nombre + (r.tu ? ' (vos)' : '')),
            el('span', 'pts', r.puntos + ' pts · ' + formatoTiempo(r.tiempo))
          );
          ol.appendChild(li);
        });
        const lista = el('div', verTodos ? 'tv-scroll' : '');
        lista.appendChild(ol);
        wrap.appendChild(lista);

        if (d.mio) wrap.appendChild(el('p', 'tv-nota', 'Tu mejor puntaje: ' + d.mio.puntos + ' pts · ' + formatoTiempo(d.mio.tiempo) + ' · puesto #' + d.mio.posicion));
        if (d.total > 5) {
          wrap.appendChild(btn(verTodos ? 'Ver menos' : 'Ver más', () => { verTodos = !verTodos; pintar(); }, 'btn-outline1 tv-vermas'));
        }
      } catch (e) {
        if (root.contains(wrap)) wrap.replaceChildren(el('p', 'tv-nota', 'No se pudo cargar el ranking. Probá de nuevo más tarde.'));
      }
    }

    wrap.recargar = pintar;
    pintar();
    return wrap;
  }

  /* ---------- pantallas ---------- */
  function inicio() {
    detenerTimer();
    S = null;
    refrescarFin = null;
    root.replaceChildren();
    root.appendChild(el('h3', '', '¿Cuánto sabés del verde?'));
    root.appendChild(el('p', '', 'Son ' + POR_PARTIDA + ' preguntas. Tenés ' + VIDAS + ' vidas y ' + TIEMPO + ' segundos por pregunta: cada error, o cada vez que se acaba el tiempo, te cuesta una vida. Las rachas suman puntos extra.'));
    const empezarBtn = btn('Empezar', empezar);
    root.appendChild(empezarBtn);
    root.appendChild(crearRanking());
    empezarBtn.focus();
  }

  function empezar() {
    refrescarFin = null;
    S = {
      qs: shuffle(PREGUNTAS.slice()).slice(0, POR_PARTIDA),
      i: 0,
      vidas: VIDAS,
      puntos: 0,
      racha: 0,
      maxRacha: 0,
      bloqueado: false,
      terminada: false,
      t0: 0,
      inicioPartida: Date.now(), // para medir el tiempo TOTAL de la partida
      tiempoTotal: 0,
      bonoVelocidad: 0,
      opts: [],
    };
    preguntar();
  }

  function hud() {
    const h = el('div', 'tv-hud');
    const v = el('div', 'tv-vidas');
    v.setAttribute('role', 'img');
    v.setAttribute('aria-label', 'Vidas: ' + S.vidas);
    for (let k = 0; k < VIDAS; k++) v.appendChild(el('span', k < S.vidas ? '' : 'off', '🌿'));
    const p = el('div', 'tv-pts');
    p.appendChild(el('b', '', S.puntos + ' pts'));
    if (S.racha > 1) p.appendChild(el('em', '', 'racha x' + S.racha));
    h.append(v, p);
    return h;
  }

  function preguntar() {
    const q = S.qs[S.i];
    S.opts = shuffle(q.a.map((t, k) => ({ t, ok: k === 0 })));
    S.bloqueado = false;
    S.t0 = Date.now();

    root.replaceChildren();
    root.appendChild(hud());
    const barra = el('div', 'tv-barra');
    const fill = el('i');
    barra.appendChild(fill);
    root.appendChild(barra);
    root.appendChild(el('div', 'tv-prog', 'Pregunta ' + (S.i + 1) + ' de ' + S.qs.length));
    root.appendChild(el('h3', '', q.q));

    const lista = el('div');
    S.opts.forEach((o, k) => {
      const b = el('button', 'tv-opt', o.t);
      b.type = 'button';
      b.addEventListener('click', () => responder(k));
      lista.appendChild(b);
    });
    root.appendChild(lista);
    S.zonaFb = el('div');
    root.appendChild(S.zonaFb);

    detenerTimer();
    timer = setInterval(() => {
      if (!S) return;
      const resta = TIEMPO - (Date.now() - S.t0) / 1000;
      const frac = Math.max(resta, 0) / TIEMPO;
      fill.style.width = frac * 100 + '%';
      fill.style.background = colorBarra(frac);
      if (resta <= 0) responder(-1);
    }, 100);
  }

  function responder(k) {
    if (!S || S.bloqueado) return;
    S.bloqueado = true;
    detenerTimer();

    const q = S.qs[S.i];
    const acerto = k >= 0 && S.opts[k].ok;
    const resta = Math.max(0, TIEMPO - (Date.now() - S.t0) / 1000);
    let titulo;
    if (acerto) {
      S.racha++;
      S.maxRacha = Math.max(S.maxRacha, S.racha);
      const p = 100 + Math.min(S.racha - 1, 4) * 20 + Math.round(resta * 4);
      S.puntos += p;
      titulo = '¡Correcto! +' + p + ' pts';
    } else {
      S.vidas--;
      S.racha = 0;
      titulo = (k < 0 ? 'Se acabó el tiempo.' : 'Casi.') + ' Perdiste una vida.';
    }

    root.querySelectorAll('.tv-opt').forEach((b, i) => {
      b.disabled = true;
      if (S.opts[i].ok) b.classList.add('ok');
      else if (i === k) b.classList.add('no');
    });
    root.querySelector('.tv-hud').replaceWith(hud());

    const terminado = S.vidas <= 0 || S.i === S.qs.length - 1;
    const caja = el('div', 'tv-fb' + (acerto ? '' : ' no'));
    caja.setAttribute('role', 'status');
    caja.appendChild(el('strong', '', titulo));
    caja.appendChild(el('p', '', q.e));
    const sig = btn(terminado ? 'Ver resultado' : 'Siguiente pregunta', () => {
      if (terminado) fin(); else { S.i++; preguntar(); }
    });
    S.zonaFb.append(caja, sig);
    sig.focus();
  }

  /* Pantalla final: puntos, puesto, guardar y top 5 */
  function fin() {
    detenerTimer();
    S.terminada = true;
    const gano = S.vidas > 0;
    const respondidas = S.i + (gano ? 1 : 0);

    // Tiempo total de la partida, desde que arrancó hasta que terminó.
    S.tiempoTotal = (Date.now() - S.inicioPartida) / 1000;

    // Bono de velocidad: compara el tiempo que tardaste contra el "presupuesto"
    // de tiempo disponible para las preguntas que realmente respondiste
    // (respondidas * TIEMPO). Cuanto más rápido respecto a ese presupuesto,
    // más puntos extra — sin castigar a quien perdió antes de terminar.
    const presupuesto = Math.max(respondidas, 1) * TIEMPO;
    S.bonoVelocidad = Math.max(0, Math.round((presupuesto - S.tiempoTotal) * 2));
    S.puntos += S.bonoVelocidad;

    const puntos = S.puntos;
    const tiempoTotal = S.tiempoTotal;
    let guardado = null; // respuesta del servidor luego de guardar

    root.replaceChildren();
    root.appendChild(el('h3', '', gano ? '¡Completaste la trivia!' : 'Te quedaste sin vidas'));
    root.appendChild(el('div', 'tv-grande', puntos + ' pts'));
    root.appendChild(el('p', '', 'Respondiste ' + respondidas + ' de ' + S.qs.length + ' preguntas. Mejor racha: ' + S.maxRacha + '. Tiempo total: ' + formatoTiempo(tiempoTotal) + '.'));
    if (S.bonoVelocidad > 0) {
      root.appendChild(el('p', 'tv-ok', '¡Bono de velocidad! +' + S.bonoVelocidad + ' pts por responder rápido.'));
    }

    const cajaPuesto = el('div', 'tv-posicion');
    const zonaGuardar = el('div', 'tv-guardar');
    const ranking = crearRanking();
    const acciones = el('div', 'tv-acciones');
    acciones.append(btn('Jugar de nuevo', empezar, 'btn-outline1'), btn('Cerrar', cerrarTrivia, 'btn-outline1'));
    root.append(cajaPuesto, zonaGuardar, ranking, acciones);

    async function pintarPuesto() {
      if (puntos <= 0) {
        cajaPuesto.replaceChildren(el('span', '', 'Sumá al menos 1 punto para entrar al ranking.'));
        return;
      }
      if (guardado) {
        cajaPuesto.replaceChildren(
          el('strong', '', 'Quedaste en el puesto #' + guardado.posicion + ' de ' + guardado.total),
          el('span', '', 'Con tu mejor puntaje: ' + guardado.mejor + ' pts · ' + formatoTiempo(guardado.mejorTiempo) + '.')
        );
        return;
      }
      try {
        const d = await api('/api/trivia/posicion?puntos=' + puntos);
        if (!guardado && root.contains(cajaPuesto)) {
          cajaPuesto.replaceChildren(
            el('strong', '', 'Con ' + puntos + ' pts quedarías en el puesto #' + d.posicion),
            el('span', '', 'Guardá tus puntos para entrar al ranking.')
          );
        }
      } catch (e) {
        cajaPuesto.replaceChildren();
      }
    }

    function pintarGuardar() {
      zonaGuardar.replaceChildren();
      if (puntos <= 0) return;
      if (guardado) {
        zonaGuardar.appendChild(el('p', 'tv-ok', guardado.mejorado
          ? '¡Puntos guardados! Es tu nuevo mejor puntaje, en ' + formatoTiempo(guardado.mejorTiempo) + '.'
          : 'Puntos recibidos. Tu mejor puntaje sigue siendo ' + guardado.mejor + ' pts (' + formatoTiempo(guardado.mejorTiempo) + ').'));
        return;
      }
      const u = usuarioActual();
      if (!u) {
        zonaGuardar.appendChild(el('p', '', 'Ingresá con tu cuenta de Google para guardar tus puntos y aparecer en el ranking.'));
        zonaGuardar.appendChild(btn('Ingresar', () => { if (typeof abrirModalLogin === 'function') abrirModalLogin(); }));
        return;
      }
      zonaGuardar.appendChild(el('p', '', 'Vas a guardar tus puntos como ' + (u.nombre || 'tu usuario') + '. En el ranking se conserva tu mejor puntaje.'));
      const msg = el('p', 'tv-error');
      const guardarBtn = btn('Guardar mis puntos', async () => {
        guardarBtn.disabled = true;
        msg.textContent = '';
        try {
          guardado = await api('/api/trivia/puntos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ puntos, tiempo: Math.round(tiempoTotal) }, identidad()))
          });
          pintarGuardar();
          pintarPuesto();
          ranking.recargar();
        } catch (e) {
          msg.textContent = e.message || 'No se pudo guardar. Probá de nuevo.';
          guardarBtn.disabled = false;
        }
      });
      zonaGuardar.append(guardarBtn, msg);
    }

    // Si inicia o cierra sesión mientras está en esta pantalla, se actualiza el menú de guardado
    refrescarFin = () => { pintarGuardar(); ranking.recargar(); };

    pintarPuesto();
    pintarGuardar();
  }

  /* ---------- abrir / cerrar ---------- */
  function abrirTrivia() {
    ultimoFoco = document.activeElement;
    modal.classList.add('active');
    inicio();
  }

  function cerrarTrivia() {
    detenerTimer();
    S = null;
    refrescarFin = null;
    modal.classList.remove('active');
    root.replaceChildren();
    if (ultimoFoco && typeof ultimoFoco.focus === 'function') ultimoFoco.focus();
  }

  window.abrirTrivia = abrirTrivia;
  window.cerrarTrivia = cerrarTrivia;

  document.getElementById('navTrivia')?.addEventListener('click', (e) => { e.preventDefault(); abrirTrivia(); });
  document.getElementById('triviaFab')?.addEventListener('click', abrirTrivia);
  document.getElementById('triviaCerrar')?.addEventListener('click', cerrarTrivia);

  // Clic afuera cierra la ventana, salvo en medio de una partida (para no perderla sin querer)
  modal.addEventListener('click', (e) => {
    if (e.target === modal && !(S && !S.terminada)) cerrarTrivia();
  });

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('active')) return;
    if (e.key === 'Escape') {
      if (!document.getElementById('modalLogin')?.classList.contains('active')) cerrarTrivia();
      return;
    }
    // Teclas 1 a 4 eligen opción mientras se juega
    if (!S || S.bloqueado || S.terminada || e.target.closest('input, textarea')) return;
    const k = parseInt(e.key, 10) - 1;
    if (k >= 0 && k < S.opts.length && root.querySelector('.tv-opt')) responder(k);
  });

  // Cuando alguien inicia o cierra sesión (setUsuario de script.js), refresca la pantalla final
  if (typeof window.setUsuario === 'function') {
    const original = window.setUsuario;
    window.setUsuario = function () {
      const resultado = original.apply(this, arguments);
      try { if (refrescarFin) refrescarFin(); } catch (e) { /* sin efecto */ }
      return resultado;
    };
  }
})();
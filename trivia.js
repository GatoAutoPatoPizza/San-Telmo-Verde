/* ============================================
   TRIVIA VERDE — minijuego de la plataforma
   Autocontenido: no usa ni pisa funciones de script.js.
   Solo lee Store.usuario (si existe) para sugerir el nombre en el ranking.
============================================ */
(function () {
  'use strict';

  const TIEMPO = 15;        // segundos por pregunta
  const VIDAS = 3;
  const POR_PARTIDA = 10;   // preguntas por partida
  const KEY_RANKING = 'stv_trivia_ranking';

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
    { q: '¿Qué es una plaza de bolsillo?', a: ['Un espacio verde pequeño en un terreno reducido de la ciudad', 'Una plaza que solo abre de noche', 'Una plaza sin árboles', 'Un estacionamiento con macetas'], e: 'Son plazas chicas que transforman lotes vacíos o esquinas en lugares de encuentro con verde.' }
  ];

  const root = document.getElementById('triviaApp');
  if (!root) return;

  let S = null;
  let timer = null;

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

  /* ---------- ranking (localStorage) ---------- */
  function cargarRanking() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY_RANKING) || '[]');
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function guardarRanking(nombre, puntos) {
    const r = cargarRanking();
    r.push({ n: nombre, s: puntos });
    r.sort((a, b) => b.s - a.s);
    try { localStorage.setItem(KEY_RANKING, JSON.stringify(r.slice(0, 5))); } catch (e) { /* sin storage */ }
  }

  function bloqueRanking() {
    const r = cargarRanking();
    const wrap = el('div', 'tv-rank');
    if (!r.length) return wrap;
    wrap.appendChild(el('h4', '', 'Mejores puntajes'));
    const ol = el('ol');
    r.forEach((x) => {
      const li = el('li', '', String(x.n));
      li.appendChild(el('span', '', x.s + ' pts'));
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  /* ---------- pantallas ---------- */
  function inicio() {
    clearInterval(timer);
    S = null;
    root.replaceChildren();
    root.appendChild(el('h3', '', '¿Cuánto sabés del verde?'));
    root.appendChild(el('p', '', 'Son ' + POR_PARTIDA + ' preguntas por partida. Cada error te cuesta una vida, y si se acaba el tiempo también.'));
    root.appendChild(btn('Empezar', empezar));
    root.appendChild(bloqueRanking());
  }

  function empezar() {
    S = { qs: shuffle(PREGUNTAS.slice()).slice(0, POR_PARTIDA), i: 0, vidas: VIDAS, puntos: 0, racha: 0, maxRacha: 0, bloqueado: false, t0: 0, opts: [] };
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
    root.appendChild(el('div', '', '')).id = 'tvFb';

    clearInterval(timer);
    timer = setInterval(() => {
      const resta = TIEMPO - (Date.now() - S.t0) / 1000;
      fill.style.width = Math.max(resta, 0) / TIEMPO * 100 + '%';
      barra.classList.toggle('urgente', resta <= 5);
      if (resta <= 0) responder(-1);
    }, 100);
  }

  function responder(k) {
    if (!S || S.bloqueado) return;
    S.bloqueado = true;
    clearInterval(timer);

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
    const viejo = root.querySelector('.tv-hud');
    viejo.replaceWith(hud());

    const terminado = S.vidas <= 0 || S.i === S.qs.length - 1;
    const fb = document.getElementById('tvFb');
    const caja = el('div', 'tv-fb' + (acerto ? '' : ' no'));
    caja.setAttribute('role', 'status');
    caja.appendChild(el('strong', '', titulo));
    caja.appendChild(el('p', '', q.e));
    fb.append(caja);
    const sig = btn(terminado ? 'Ver resultado' : 'Siguiente pregunta', () => {
      if (terminado) fin(); else { S.i++; preguntar(); }
    });
    fb.append(sig);
    sig.focus();
  }

  function fin() {
    clearInterval(timer);
    const gano = S.vidas > 0;
    const respondidas = S.i + (gano ? 1 : 0);
    root.replaceChildren();
    root.appendChild(el('h3', '', gano ? '¡Completaste la trivia!' : 'Te quedaste sin vidas'));
    root.appendChild(el('div', 'tv-grande', S.puntos + ' pts'));
    root.appendChild(el('p', '', 'Respondiste ' + respondidas + ' de ' + S.qs.length + ' preguntas. Mejor racha: ' + S.maxRacha + '.'));

    const fila = el('div', 'tv-guardar');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'Tu nombre';
    input.setAttribute('aria-label', 'Tu nombre');
    try { if (typeof Store !== 'undefined' && Store.usuario && Store.usuario.nombre) input.value = String(Store.usuario.nombre).slice(0, 20); } catch (e) { /* sin sesión */ }
    const guardar = btn('Guardar puntaje', () => {
      guardarRanking(input.value.trim() || 'Anónimo', S.puntos);
      guardar.disabled = true;
      const nuevo = bloqueRanking();
      root.querySelector('.tv-rank')?.replaceWith(nuevo);
    });
    fila.append(input, guardar);
    root.appendChild(fila);
    root.appendChild(btn('Jugar de nuevo', empezar, 'btn-outline1'));
    root.appendChild(bloqueRanking());
  }

  // Atajo de teclado: 1 a 4 eligen opción mientras se juega
  document.addEventListener('keydown', (e) => {
    if (!S || S.bloqueado || e.target.closest('input, textarea')) return;
    const k = parseInt(e.key, 10) - 1;
    if (k >= 0 && k < S.opts.length && root.querySelector('.tv-opt')) responder(k);
  });

  inicio();
})();

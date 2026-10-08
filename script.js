/* ============================================
   SAN TELMO VERDE — LÓGICA (JS)
   Estado centralizado + votación unificada
============================================ */

const CENTRO_SAN_TELMO = [-34.6212, -58.3714];

/* Fichas fijas del mapa (espacios verdes existentes e islas de calor).
   Centralizadas acá (con id) para poder: 1) dibujar el marcador,
   2) abrir su ficha de detalle al clickear el marcador, y
   3) ubicarlas en el mapa desde un botón "Ver en el mapa". */
/* Estos datos son el RESPALDO: la fuente real es la tabla `zonas_mapa` (GET /api/zonas).
   Si la API no responde se usan estos valores. */
const ESPACIOS_VERDES = [
  { id: 'verde-lezama', lat: -34.6289, lng: -58.3697, simbolo: 'P', titulo: 'Parque Lezama', resumen: '7.2 ha · El más grande del barrio', detalle: 'El espacio verde más grande de San Telmo, con 7.2 hectáreas. Zona histórica con anfiteatro, el Museo Histórico Nacional y una gran variedad de árboles añosos.' },
  { id: 'verde-dorrego', lat: -34.6212, lng: -58.3731, simbolo: '', titulo: 'Plazoleta Dorrego', resumen: '0.3 ha · Centro histórico', detalle: 'Plaza chica en pleno centro histórico de San Telmo, rodeada de anticuarios. Sede de la feria de los domingos.' },
  { id: 'verde-humberto', lat: -34.6175, lng: -58.3720, simbolo: '', titulo: 'Plazoleta Calle Humberto', resumen: 'Pequeña plaza de barrio', detalle: 'Espacio verde chico sobre la calle Humberto Primo, de uso vecinal cotidiano.' },
];

const ISLAS_CALOR = [
  { id: 'calor-norte', lat: -34.6165, lng: -58.3775, titulo: 'Isla de calor · Zona norte', resumen: '+3.2°C', detalle: 'Zona con muy poca cobertura verde y alta densidad de construcción, lo que eleva la temperatura superficial respecto al resto del barrio.' },
  { id: 'calor-centro', lat: -34.6245, lng: -58.3715, titulo: 'Isla de calor · Zona central', resumen: '+2.8°C', detalle: 'Concentración de superficies de asfalto y hormigón sin arbolado que retienen calor durante el día y lo liberan de noche.' },
  { id: 'calor-este', lat: -34.6195, lng: -58.3675, titulo: 'Isla de calor · Zona este', resumen: '+4.1°C', detalle: 'La zona con mayor diferencia de temperatura registrada del barrio, cerca de la avenida Paseo Colón, con escasa vegetación.' },
];
/* API_BASE vacío = rutas relativas ("/api/...").
   Así el front pega siempre al MISMO host que lo sirvió, sea
   http://localhost:3000, tu Codespace (*.app.github.dev) o
   cualquier otro dominio público. NO hardcodear localhost acá. */
const API_BASE = '';

/* ── PEGÁ ACÁ tu Client ID de Google Cloud Console ──
   Debe coincidir con data-client_id en index.html
   Ejemplo: '123456789-abc.apps.googleusercontent.com' */
const GOOGLE_CLIENT_ID = '238089660652-b04ml760v9nqbtnjuenubc5a1p1mla6r.apps.googleusercontent.com';

/* Emails autorizados a moderar (coinciden con el email de Google al ingresar).
   Agregá los del equipo. También podés usar el flag local stv_soy_mod=1 en consola. */
const MODERADORES = [
  'thiagovillagodoy@gmail.com',
  // 'otro.moderador@gmail.com',
];

const KEYS = {
  propuestas: 'stv_propuestas',
  usuario: 'stv_usuario',
  votos: 'stv_votos',
  denuncias: 'stv_denuncias', // { [userId]: { [propuestaId]: true } }
  likesZonas: 'stv_likes_zonas', // { [userId]: { [zonaId]: true } }
};

const Store = {
  propuestas: [],
  usuario: null,
  votosUsuario: new Set(),
  likesZonasUsuario: new Set(), // ids de zonas verdes que el usuario marcó con me gusta
  modoUbicacionDestino: 'propuesta', // 'propuesta' | 'zona' (moderador cargando una zona)
  marcadores: {},
  marcadoresVerde: {},
  marcadoresCalor: {},
  marcadorTemporal: null,
  ubicacion: null,        // { lat, lng, precision } del usuario
  marcadorUsuario: null,
  circuloUsuario: null,
  buscandoUbicacion: false,
  geoPedida: false,       // true una vez que ya pedimos la ubicación en esta visita
  modoUbicacion: false,
  mapa: null,
  capas: { verde: null, calor: null, prop: null },
  filtros: { verde: true, calor: true, prop: true },
  tabLista: 'propuestas', // pestaña activa del menú: 'propuestas' | 'verde' | 'calor'
  resaltarAlRenderizar: null, // { tipo, id } — para "ver en la lista" desde el mapa
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function hydrateStore() {
  Store.usuario = loadJSON(KEYS.usuario, null);
  Store.propuestas = loadJSON(KEYS.propuestas, []);
  syncVotosUsuarioFromStorage();
  syncLikesZonasFromStorage();
}

function persistPropuestas() {
  saveJSON(KEYS.propuestas, Store.propuestas);
}

function persistUsuario() {
  if (Store.usuario) saveJSON(KEYS.usuario, Store.usuario);
  else localStorage.removeItem(KEYS.usuario);
}

function syncVotosUsuarioFromStorage() {
  Store.votosUsuario = new Set();
  if (!Store.usuario) return;
  const all = loadJSON(KEYS.votos, {});
  const mine = all[Store.usuario.id] || {};
  Object.keys(mine).forEach((id) => {
    if (mine[id]) Store.votosUsuario.add(String(id));
  });
}

function syncLikesZonasFromStorage() {
  Store.likesZonasUsuario = new Set();
  if (!Store.usuario) return;
  const mine = loadJSON(KEYS.likesZonas, {})[Store.usuario.id] || {};
  Object.keys(mine).forEach((id) => { if (mine[id]) Store.likesZonasUsuario.add(String(id)); });
}

function persistLikeZona(zonaId, meGusta) {
  if (!Store.usuario) return;
  const all = loadJSON(KEYS.likesZonas, {});
  if (!all[Store.usuario.id]) all[Store.usuario.id] = {};
  if (meGusta) all[Store.usuario.id][String(zonaId)] = true;
  else delete all[Store.usuario.id][String(zonaId)];
  saveJSON(KEYS.likesZonas, all);
  if (meGusta) Store.likesZonasUsuario.add(String(zonaId));
  else Store.likesZonasUsuario.delete(String(zonaId));
}

function persistVoto(propuestaId) {
  if (!Store.usuario) return;
  const all = loadJSON(KEYS.votos, {});
  if (!all[Store.usuario.id]) all[Store.usuario.id] = {};
  all[Store.usuario.id][String(propuestaId)] = true;
  saveJSON(KEYS.votos, all);
  Store.votosUsuario.add(String(propuestaId));
}

function quitarVotoLocal(propuestaId) {
  if (!Store.usuario) return;
  const all = loadJSON(KEYS.votos, {});
  if (all[Store.usuario.id]) {
    delete all[Store.usuario.id][String(propuestaId)];
    saveJSON(KEYS.votos, all);
  }
  Store.votosUsuario.delete(String(propuestaId));
}

/** Lista completa de denuncias locales para el panel de moderación */
function loadDenunciasRecords() {
  const raw = loadJSON(KEYS.denuncias, []);
  // Migrar formato viejo { userId: { propId: true } } → []
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    saveJSON(KEYS.denuncias, []);
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

function saveDenunciasRecords(list) {
  saveJSON(KEYS.denuncias, list);
}

function yaDenuncie(propuestaId) {
  if (!Store.usuario) return false;
  const list = loadDenunciasRecords();
  return list.some(
    (d) =>
      String(d.propuesta_id) === String(propuestaId) &&
      (String(d.usuario_id) === String(Store.usuario.id) ||
        d.email === Store.usuario.email) &&
      d.estado !== 'descartada'
  );
}

function marcarDenunciaLocal(propuestaId, motivo) {
  if (!Store.usuario) return;
  const list = loadDenunciasRecords();
  // evitar duplicado activo
  const exists = list.find(
    (d) =>
      String(d.propuesta_id) === String(propuestaId) &&
      (String(d.usuario_id) === String(Store.usuario.id) || d.email === Store.usuario.email)
  );
  if (exists) {
    exists.motivo = motivo || exists.motivo;
    exists.estado = 'pendiente';
    exists.updated_at = new Date().toISOString();
  } else {
    list.unshift({
      id: 'den_' + Date.now().toString(36),
      propuesta_id: String(propuestaId),
      usuario_id: String(Store.usuario.id),
      email: Store.usuario.email,
      nombre: Store.usuario.nombre,
      motivo: motivo || 'Sin motivo especificado',
      estado: 'pendiente',
      created_at: new Date().toISOString(),
    });
  }
  saveDenunciasRecords(list);
}

function esModerador() {
  if (!Store.usuario) return false;
  if (localStorage.getItem('stv_soy_mod') === '1') return true;
  const email = (Store.usuario.email || '').toLowerCase().trim();
  return MODERADORES.some((m) => m && m.toLowerCase().trim() === email);
}

/* ── Panel de moderación ──
   El backend (server.js) autoriza estas acciones validando el email
   de moderador contra MODERADORES (env var) o el default en server.js.
   Si acá pasás esModerador() pero el server responde 403, revisá que
   tu email esté también en el servidor. */
function emailModerador() {
  return Store.usuario?.email || '';
}

function abrirModalModeracion() {
  if (!esModerador()) return;
  document.getElementById('modalModeracion')?.classList.add('active');
  cargarDenunciasMod();
  cargarPropuestasMod();
}

function cerrarModalModeracion() {
  document.getElementById('modalModeracion')?.classList.remove('active');
}

function cambiarTabMod(btn) {
  const tab = btn?.dataset?.tab;
  if (!tab) return;
  document.querySelectorAll('.mod-tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.getElementById('modTabDenuncias')?.classList.toggle('hidden', tab !== 'denuncias');
  document.getElementById('modTabPropuestas')?.classList.toggle('hidden', tab !== 'propuestas');
  document.getElementById('modTabZonas')?.classList.toggle('hidden', tab !== 'zonas');
  if (tab === 'zonas') renderModZonas();
}

// ── Moderación: agregar / eliminar zonas (espacios verdes e islas de calor) ──

function renderModZonas() {
  const cont = document.getElementById('modZonasList');
  if (!cont) return;
  const todas = [
    ...ESPACIOS_VERDES.map((f) => ({ ...f, tipo: 'verde' })),
    ...ISLAS_CALOR.map((f) => ({ ...f, tipo: 'calor' })),
  ];
  if (!todas.length) {
    cont.innerHTML = '<div class="mod-empty">Todavía no hay zonas cargadas.</div>';
    return;
  }
  cont.innerHTML = todas.map((f) => `
    <div class="mod-card">
      <h4>${f.tipo === 'verde' ? '🌳' : '🌡️'} ${escapeHtml(f.titulo)}</h4>
      <div class="mod-meta">${escapeHtml(f.resumen)}${f.tipo === 'verde' ? ` · 💚 ${f.likes || 0}` : ''}</div>
      <div class="mod-actions">
        <button type="button" class="mod-btn" onclick="verZonaDesdeMod('${f.tipo}', '${escapeHtml(f.id)}')">📍 Ver en el mapa</button>
        <button type="button" class="mod-btn mod-btn-danger" onclick="eliminarZonaMod('${escapeHtml(f.id)}')">Eliminar</button>
      </div>
    </div>`).join('');
}

function verZonaDesdeMod(tipo, id) {
  const f = (tipo === 'verde' ? ESPACIOS_VERDES : ISLAS_CALOR).find((x) => x.id === id);
  if (!f) return;
  cerrarModalModeracion();
  irAMapa(f.lat, f.lng, tipo, f.id);
}

// Paso 1: "Marcar en el mapa" → cerramos el panel, entramos en modo ubicación
// y esperamos el click del moderador sobre el mapa.
function elegirUbicacionZonaMod() {
  Store.modoUbicacionDestino = 'zona';
  Store.modoUbicacion = true;
  textoBannerUbicacion('📍 Hacé clic en el mapa para marcar la ubicación de la zona');
  document.getElementById('modoUbicacionBanner')?.classList.remove('hidden');
  document.getElementById('map')?.classList.add('cursor-crosshair');
  cerrarModalModeracion();
  mostrarVista('mapa');
}

async function guardarZonaMod() {
  const titulo = document.getElementById('modZonaTitulo')?.value.trim();
  const tipo = document.querySelector('input[name="modZonaTipo"]:checked')?.value;
  const resumen = document.getElementById('modZonaResumen')?.value.trim();
  const detalle = document.getElementById('modZonaDetalle')?.value.trim();
  const lat = document.getElementById('modZonaLat')?.value;
  const lng = document.getElementById('modZonaLng')?.value;
  const error = document.getElementById('modZonaError');
  const mostrarError = (msg) => { if (error) error.textContent = msg; };

  if (!titulo) return mostrarError('Poné un nombre para la zona.');
  if (!tipo) return mostrarError('Elegí si es un espacio verde o una isla de calor.');
  if (!lat || !lng) return mostrarError('Marcá la ubicación en el mapa.');
  mostrarError('');

  try {
    const res = await fetch(`${API_BASE}/api/mod/zonas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailModerador(),
        usuario_id: Store.usuario?.id,
        google_id: Store.usuario?.google_id,
        titulo, tipo, resumen, detalle,
        latitud: Number(lat),
        longitud: Number(lng),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return mostrarError(data.error || 'No se pudo guardar la zona.');
    }
  } catch (_) {
    return mostrarError('No se pudo conectar con el servidor.');
  }

  limpiarFormZonaMod();
  clearMarcadorTemporal();
  await cargarZonasDesdeAPI();
  renderAll();
  renderModZonas();
}

function limpiarFormZonaMod() {
  ['modZonaTitulo', 'modZonaResumen', 'modZonaDetalle', 'modZonaLat', 'modZonaLng'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const texto = document.getElementById('modZonaUbicacionTexto');
  if (texto) {
    texto.textContent = 'Sin ubicación marcada';
    texto.classList.remove('marcada');
  }
}

async function eliminarZonaMod(id) {
  if (!confirm('¿Eliminar esta zona del mapa? También se borran sus me gusta. No se puede deshacer.')) return;
  try {
    const res = await fetch(`${API_BASE}/api/mod/zonas/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });
    if (!res.ok) throw new Error('no autorizado');
  } catch (_) {
    alert('No se pudo eliminar la zona. ¿Tu email está en MODERADORES del servidor?');
    return;
  }
  await cargarZonasDesdeAPI();
  renderAll();
  renderModZonas();
}

// ── Me gusta en zonas verdes ──
// Toggle con actualización optimista y confirmación del servidor.
async function darLikeZona(id) {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return;
  }
  const zid = String(id);
  const zona = ESPACIOS_VERDES.find((f) => f.id === zid);
  if (!zona) return;
  const antes = { likes: zona.likes || 0, meGusta: select.diLikeZona(zid) };

  zona.likes = Math.max(0, antes.likes + (antes.meGusta ? -1 : 1));
  persistLikeZona(zid, !antes.meGusta);
  refrescarLikesEnPantalla();

  try {
    const res = await fetch(`${API_BASE}/api/zonas/${encodeURIComponent(zid)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: Store.usuario.id,
        email: Store.usuario.email,
        google_id: Store.usuario.google_id,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (typeof data.likes === 'number') zona.likes = data.likes;
    if (typeof data.meGusta === 'boolean') persistLikeZona(zid, data.meGusta);
  } catch (_) {
    // Si el servidor no confirmó, volvemos al estado anterior (no dejar un like "fantasma")
    zona.likes = antes.likes;
    persistLikeZona(zid, antes.meGusta);
  }
  refrescarLikesEnPantalla();
}

// Trae del servidor qué zonas le gustaron al usuario (funciona entre dispositivos)
async function sincronizarLikesZonasConServidor() {
  if (!Store.usuario) return;
  try {
    const q = new URLSearchParams({
      usuario_id: Store.usuario.id || '',
      email: Store.usuario.email || '',
      google_id: Store.usuario.google_id || '',
    });
    const res = await fetch(`${API_BASE}/api/zonas/mis-likes?${q}`);
    if (!res.ok) return;
    const ids = await res.json();
    if (!Array.isArray(ids)) return;
    Store.likesZonasUsuario = new Set(ids.map(String));
    const all = loadJSON(KEYS.likesZonas, {});
    all[Store.usuario.id] = Object.fromEntries(ids.map((i) => [String(i), true]));
    saveJSON(KEYS.likesZonas, all);
    refrescarLikesEnPantalla();
  } catch (_) {}
}

function botonLikeZonaHTML(f) {
  const liked = select.diLikeZona(f.id);
  return `<button type="button" class="like-btn ${liked ? 'liked' : ''}" onclick="darLikeZona('${escapeHtml(f.id)}')"
    title="${liked ? 'Quitar me gusta' : 'Me gusta este espacio'}">${liked ? '💚' : '🤍'} <span>${f.likes || 0}</span></button>`;
}

// Redibuja todo lo que muestra likes sin cerrar el popup que esté abierto
function refrescarLikesEnPantalla() {
  ESPACIOS_VERDES.forEach((f) => {
    const m = Store.marcadoresVerde[f.id];
    if (m) m.setPopupContent(popupFichaHTML(f, 'verde'));
  });
  renderListaPropuestas();
  renderPanelLateral();
  if (document.getElementById('modalTotal')?.classList.contains('active')) renderResultadosModal();
  if (document.getElementById('modalModeracion')?.classList.contains('active')) renderModZonas();
}

async function cargarDenunciasMod() {
  const cont = document.getElementById('modDenunciasList');
  if (!cont) return;
  cont.innerHTML = '<div class="mod-empty">Cargando…</div>';
  try {
    const res = await fetch(`${API_BASE}/api/mod/denuncias?email=${encodeURIComponent(emailModerador())}`);
    if (!res.ok) throw new Error('No autorizado');
    const denuncias = await res.json();
    renderModDenuncias(denuncias);
  } catch (_) {
    cont.innerHTML = '<div class="mod-empty">No se pudieron cargar las denuncias. ¿Tu email está en MODERADORES del servidor?</div>';
  }
}

function renderModDenuncias(denuncias) {
  const cont = document.getElementById('modDenunciasList');
  if (!cont) return;
  if (!denuncias || denuncias.length === 0) {
    cont.innerHTML = '<div class="mod-empty">No hay denuncias pendientes.</div>';
    return;
  }
  cont.innerHTML = denuncias
    .map(
      (d) => `
      <div class="mod-card">
        <h4>${escapeHtml(d.titulo || 'Propuesta eliminada')}</h4>
        <p><strong>Motivo:</strong> ${escapeHtml(d.motivo || 'Sin motivo')}</p>
        <p><strong>Denunciante:</strong> ${escapeHtml(d.denunciante || 'Desconocido')}</p>
        <div class="mod-meta">Propuesta #${escapeHtml(String(d.propuesta_id))} · ${escapeHtml(d.propuesta_estado || '')}</div>
        <div class="mod-actions">
          <button type="button" class="mod-btn mod-btn-archive" onclick="archivarDesdeDenuncia('${d.id}', '${d.propuesta_id}')">Archivar propuesta</button>
          <button type="button" class="mod-btn mod-btn-ok" onclick="descartarDenuncia('${d.id}')">Descartar denuncia</button>
          <button type="button" class="mod-btn mod-btn-danger" onclick="eliminarDenuncia('${d.id}')">Eliminar denuncia</button>
        </div>
      </div>`
    )
    .join('');
}

async function eliminarDenuncia(id) {
  if (!confirm('¿Eliminar esta denuncia definitivamente? No se puede deshacer.')) return;
  try {
    await fetch(`${API_BASE}/api/mod/denuncias/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });
  } catch (_) {}
  cargarDenunciasMod();
}

async function descartarDenuncia(id) {
  try {
    await fetch(`${API_BASE}/api/mod/denuncias/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador(), estado: 'descartada' }),
    });
  } catch (_) {}
  cargarDenunciasMod();
}

async function archivarDesdeDenuncia(id, propuestaId) {
  try {
    await fetch(`${API_BASE}/api/mod/denuncias/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador(), estado: 'revisada', propuesta_id: propuestaId }),
    });
  } catch (_) {}
  cargarDenunciasMod();
  cargarPropuestasMod();
  await intentarCargarDesdeAPI();
  renderAll();
}

async function cargarPropuestasMod() {
  const cont = document.getElementById('modPropuestasList');
  if (!cont) return;
  cont.innerHTML = '<div class="mod-empty">Cargando…</div>';
  try {
    const res = await fetch(`${API_BASE}/api/mod/propuestas?email=${encodeURIComponent(emailModerador())}`);
    if (!res.ok) throw new Error('No autorizado');
    const propuestas = await res.json();
    renderModPropuestas(propuestas);
  } catch (_) {
    cont.innerHTML = '<div class="mod-empty">No se pudieron cargar las propuestas. ¿Tu email está en MODERADORES del servidor?</div>';
  }
}

/* Estado de selección múltiple en el panel de moderación */
const ModSelect = {
  ids: new Set(),
  propuestasCache: [],
};

function actualizarContadorSeleccion() {
  const n = ModSelect.ids.size;
  const el = document.getElementById('modBulkCount');
  if (el) el.textContent = n === 1 ? '1 seleccionada' : `${n} seleccionadas`;
  const all = document.getElementById('modSelectAll');
  if (all) {
    const total = ModSelect.propuestasCache.length;
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
}

function toggleSeleccionarPropuesta(id, checked) {
  const sid = String(id);
  if (checked) ModSelect.ids.add(sid);
  else ModSelect.ids.delete(sid);
  const card = document.querySelector(`.mod-card[data-id="${sid}"]`);
  if (card) card.classList.toggle('selected', checked);
  actualizarContadorSeleccion();
}

function toggleSeleccionarTodas(checked) {
  ModSelect.ids.clear();
  document.querySelectorAll('#modPropuestasList .mod-card-check').forEach((cb) => {
    cb.checked = checked;
    const id = cb.dataset.id;
    if (checked && id) ModSelect.ids.add(String(id));
    const card = cb.closest('.mod-card');
    if (card) card.classList.toggle('selected', checked);
  });
  actualizarContadorSeleccion();
}

function idsSeleccionados() {
  return [...ModSelect.ids];
}

function renderModPropuestas(propuestas) {
  const cont = document.getElementById('modPropuestasList');
  if (!cont) return;
  ModSelect.propuestasCache = Array.isArray(propuestas) ? propuestas : [];
  ModSelect.ids.clear();
  const allCb = document.getElementById('modSelectAll');
  if (allCb) {
    allCb.checked = false;
    allCb.indeterminate = false;
  }
  actualizarContadorSeleccion();

  if (!propuestas || propuestas.length === 0) {
    cont.innerHTML = '<div class="mod-empty">No hay propuestas todavía.</div>';
    return;
  }
  cont.innerHTML = propuestas
    .map((p) => {
      const archivada = p.estado === 'Archivada';
      const badge = archivada ? '<span class="mod-badge archivada">Archivada</span>' : `<span class="mod-badge">${escapeHtml(p.estado)}</span>`;
      const accion = archivada
        ? `<button type="button" class="mod-btn mod-btn-restore" onclick="restaurarPropuestaMod('${p.id}')">Restaurar</button>`
        : `<button type="button" class="mod-btn mod-btn-archive" onclick="archivarPropuestaMod('${p.id}')">Archivar</button>`;
      const eliminarBtn = `<button type="button" class="mod-btn mod-btn-danger" onclick="eliminarPropuestaMod('${p.id}')">Eliminar</button>`;
      const banActivo = p.usuario_id && p.usuario_baneado_hasta
        ? new Date(p.usuario_baneado_hasta).getTime() > Date.now()
        : false;
      const banBtn = p.usuario_id
        ? (banActivo
          ? `<button type="button" class="mod-btn mod-btn-unban" data-uid="${escapeHtml(String(p.usuario_id))}" data-unombre="${escapeHtml(p.nombre_usuario || 'Usuario')}" onclick="desbanearUsuarioMod(this.dataset.uid, this.dataset.unombre)">Desbanear autor</button>`
          : `<button type="button" class="mod-btn mod-btn-ban" data-uid="${escapeHtml(String(p.usuario_id))}" data-unombre="${escapeHtml(p.nombre_usuario || 'Usuario')}" onclick="abrirModalBan(this.dataset.uid, this.dataset.unombre)">Banear autor</button>`)
        : '';
      return `
      <div class="mod-card" data-id="${escapeHtml(String(p.id))}" data-usuario-id="${escapeHtml(String(p.usuario_id || ''))}" data-estado="${escapeHtml(p.estado || '')}">
        <input type="checkbox" class="mod-card-check" data-id="${escapeHtml(String(p.id))}"
          onchange="toggleSeleccionarPropuesta('${p.id}', this.checked)" title="Seleccionar propuesta" />
        <h4>${escapeHtml(p.titulo)} ${badge}</h4>
        <p>${escapeHtml(p.descripcion || '')}</p>
        <div class="mod-meta">${escapeHtml(p.direccion || '')} · ${escapeHtml(p.nombre_usuario || 'Anonimo')} · ${p.votos || 0} votos</div>
        <div class="mod-actions">${accion}${eliminarBtn}${banBtn}</div>
      </div>`;
    })
    .join('');
}

async function archivarPropuestaMod(id) {
  try {
    await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}/archivar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });
  } catch (_) {}
  cargarPropuestasMod();
  await intentarCargarDesdeAPI();
  renderAll();
}

async function restaurarPropuestaMod(id) {
  try {
    await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}/restaurar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });
  } catch (_) {}
  cargarPropuestasMod();
  await intentarCargarDesdeAPI();
  renderAll();
}

async function eliminarPropuestaMod(id) {
  if (!confirm('¿Eliminar esta propuesta definitivamente? También se borran sus votos y denuncias asociadas. No se puede deshacer.')) return;
  try {
    await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });
  } catch (_) {}
  cargarPropuestasMod();
  cargarDenunciasMod();
  await intentarCargarDesdeAPI();
  renderAll();
}

/** Acciones masivas sobre las propuestas seleccionadas en el panel */
async function accionesMasivas(accion) {
  const ids = idsSeleccionados();
  if (!ids.length) {
    alert('Seleccioná al menos una propuesta con los checkboxes.');
    return;
  }

  if (accion === 'eliminar') {
    if (!confirm(`¿Eliminar ${ids.length} propuesta(s) definitivamente? No se puede deshacer.`)) return;
  }
  if (accion === 'banear') {
    const autores = new Map();
    ids.forEach((id) => {
      const card = document.querySelector(`.mod-card[data-id="${id}"]`);
      const uid = card?.dataset?.usuarioId;
      if (uid) {
        const nombre = card.querySelector('.mod-meta')?.textContent?.split('·')[1]?.trim() || 'Usuario';
        autores.set(String(uid), nombre);
      }
    });
    if (!autores.size) {
      alert('Ninguna de las propuestas seleccionadas tiene un autor registrado para banear.');
      return;
    }
    abrirModalBanMulti([...autores.keys()], [...autores.values()]);
    return;
  }

  const email = emailModerador();
  const promesas = ids.map(async (id) => {
    try {
      if (accion === 'archivar') {
        await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}/archivar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      } else if (accion === 'restaurar') {
        await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}/restaurar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      } else if (accion === 'eliminar') {
        await fetch(`${API_BASE}/api/mod/propuestas/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      }
    } catch (_) {}
  });
  await Promise.all(promesas);
  ModSelect.ids.clear();
  cargarPropuestasMod();
  if (accion === 'eliminar') cargarDenunciasMod();
  await intentarCargarDesdeAPI();
  renderAll();
}

/* ── Ban / timeout de usuarios ── */
let _banPendiente = null; // { usuarioIds: string[], nombres: string[] }

function abrirModalBan(usuarioId, nombre) {
  if (!usuarioId) return;
  _banPendiente = { usuarioIds: [String(usuarioId)], nombres: [nombre || 'Usuario'] };
  const hint = document.getElementById('banDuracionHint');
  if (hint) hint.textContent = `Banear a ${nombre || 'Usuario'} por contenido no serio. Elegí la duración:`;
  document.getElementById('modalBanDuracion')?.classList.add('active');
}

function abrirModalBanMulti(usuarioIds, nombres) {
  _banPendiente = { usuarioIds: usuarioIds.map(String), nombres: nombres || [] };
  const hint = document.getElementById('banDuracionHint');
  const n = usuarioIds.length;
  if (hint) hint.textContent = `Banear a ${n} autor(es) por contenido no serio. Elegí la duración:`;
  document.getElementById('modalBanDuracion')?.classList.add('active');
}

function cerrarModalBan() {
  document.getElementById('modalBanDuracion')?.classList.remove('active');
  _banPendiente = null;
}

function formatearDuracionBan(minutos) {
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? '' : 's'}`;
  if (minutos < 1440) {
    const h = Math.round(minutos / 60);
    return `${h} hora${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(minutos / 1440);
  return `${d} día${d === 1 ? '' : 's'}`;
}

async function confirmarBan(minutos) {
  if (!_banPendiente || !_banPendiente.usuarioIds.length) {
    cerrarModalBan();
    return;
  }
  const email = emailModerador();
  const ids = [..._banPendiente.usuarioIds];
  cerrarModalBan();
  const resultados = await Promise.all(
    ids.map(async (uid) => {
      try {
        const res = await fetch(`${API_BASE}/api/mod/usuarios/${encodeURIComponent(uid)}/banear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, minutos }),
        });
        return res.ok;
      } catch (_) {
        return false;
      }
    })
  );
  const ok = resultados.filter(Boolean).length;
  alert(
    ok
      ? `Se baneó a ${ok} usuario(s) por ${formatearDuracionBan(minutos)}.`
      : 'No se pudo aplicar el ban. Verificá que el servidor esté en marcha y que tu email esté en MODERADORES.'
  );
  await cargarPropuestasMod();
}

/** Quita inmediatamente el ban activo de un usuario desde el panel de moderación. */
async function desbanearUsuarioMod(usuarioId, nombre) {
  if (!usuarioId) return;
  const nombreSeguro = nombre || 'este usuario';
  if (!confirm(`¿Desbanear a ${nombreSeguro}? Podrá volver a publicar inmediatamente.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/mod/usuarios/${encodeURIComponent(usuarioId)}/desbanear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailModerador() }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'No se pudo desbanear al usuario.');
      return;
    }

    if (Store.usuario && String(Store.usuario.id) === String(usuarioId)) {
      Store.usuario.baneado_hasta = null;
      persistUsuario();
      actualizarBannerBan();
    }

    alert(`${nombreSeguro} fue desbaneado correctamente.`);
    await cargarPropuestasMod();
  } catch (_) {
    alert('No se pudo desbanear al usuario. Verificá que el servidor esté en marcha.');
  }
}

/** Texto legible del tiempo restante de ban */
function textoTiempoRestanteBan(hastaISO) {
  if (!hastaISO) return '';
  const hasta = new Date(hastaISO).getTime();
  const ahora = Date.now();
  const ms = hasta - ahora;
  if (ms <= 0) return '';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const horas = Math.floor(min / 60);
  const restoMin = min % 60;
  if (horas < 24) {
    return restoMin > 0
      ? `${horas} hora${horas === 1 ? '' : 's'} y ${restoMin} min`
      : `${horas} hora${horas === 1 ? '' : 's'}`;
  }
  const dias = Math.floor(horas / 24);
  const restoH = horas % 24;
  return restoH > 0
    ? `${dias} día${dias === 1 ? '' : 's'} y ${restoH} h`
    : `${dias} día${dias === 1 ? '' : 's'}`;
}

function usuarioEstaBaneado() {
  const hasta = Store.usuario?.baneado_hasta;
  if (!hasta) return false;
  return new Date(hasta).getTime() > Date.now();
}

function actualizarBannerBan() {
  const banner = document.getElementById('banBanner');
  const msg = document.getElementById('banBannerMsg');
  const wrap = document.getElementById('propuestaFormWrap');
  const campos = document.getElementById('formPropuestaCampos');
  if (!banner || !msg) return;

  if (usuarioEstaBaneado()) {
    const tiempo = textoTiempoRestanteBan(Store.usuario.baneado_hasta);
    msg.textContent = `Estás baneado por ${tiempo || 'un tiempo'}, por favor, retírese y vuelva a intentarlo más tarde.`;
    banner.classList.remove('hidden');
    wrap?.classList.add('form-propuesta-bloqueada');
    if (campos) campos.setAttribute('aria-disabled', 'true');
  } else {
    banner.classList.add('hidden');
    wrap?.classList.remove('form-propuesta-bloqueada');
    if (campos) campos.removeAttribute('aria-disabled');
    if (Store.usuario) Store.usuario.baneado_hasta = null;
  }
}

/** Consulta al servidor el estado de ban del usuario logueado */
async function refrescarEstadoBan() {
  if (!Store.usuario) {
    actualizarBannerBan();
    return;
  }
  try {
    const q = new URLSearchParams();
    if (Store.usuario.email) q.set('email', Store.usuario.email);
    if (Store.usuario.id) q.set('id', String(Store.usuario.id));
    if (Store.usuario.google_id) q.set('google_id', String(Store.usuario.google_id));
    const res = await fetch(`${API_BASE}/api/usuarios/estado-ban?${q.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.baneado && data.baneado_hasta) {
        Store.usuario.baneado_hasta = data.baneado_hasta;
      } else {
        Store.usuario.baneado_hasta = null;
      }
    }
  } catch (_) {}
  actualizarBannerBan();
}

/** ¿La propuesta es del usuario logueado? (por usuario_id o email/nombre de creador) */
function esPropuestaMia(p) {
  if (!Store.usuario || !p) return false;
  if (p.usuario_id && String(p.usuario_id) === String(Store.usuario.id)) return true;
  if (p.usuario_id && Store.usuario.google_id && String(p.usuario_id) === String(Store.usuario.google_id)) return true;
  // Fallback: mismo nombre de usuario guardado al crear (sesión local)
  if (p.nombre_usuario && Store.usuario.nombre && p.nombre_usuario === Store.usuario.nombre) {
    // solo si además hay match de email implícito en sesión reciente — preferimos ids
    if (p.usuario_id == null || p.usuario_id === '' || String(p.usuario_id) === String(Store.usuario.id)) return true;
  }
  return false;
}

const select = {
  isLoggedIn: () => !!Store.usuario,
  yaVoto: (id) => Store.votosUsuario.has(String(id)),
  diLikeZona: (id) => Store.likesZonasUsuario.has(String(id)),
  propuestaById: (id) => Store.propuestas.find((p) => String(p.id) === String(id)) || null,
  propuestasActivas: () => Store.propuestas.filter((p) => (p.estado || '') !== 'Archivada'),
  topPropuestas: (n = 3) =>
    [...select.propuestasActivas()].sort((a, b) => (b.votos || 0) - (a.votos || 0)).slice(0, n),
};

// Espacios verdes ordenados por "me gusta" (el más querido primero; empates mantienen el orden original)
function verdesPorLikes() {
  return ESPACIOS_VERDES.map((f, i) => ({ f, i }))
    .sort((a, b) => (b.f.likes || 0) - (a.f.likes || 0) || a.i - b.i)
    .map((x) => x.f);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearFecha(iso) {
  if (!iso) return 'ahora';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'ahora';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' h';
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function estadoClass(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('revis')) return 'estado-revision';
  if (e.includes('aprob')) return 'estado-aprobada';
  return 'estado-nueva';
}

function normalizePropuesta(p) {
  return {
    id: String(p.id),
    titulo: p.titulo || '',
    direccion: p.direccion || '',
    descripcion: p.descripcion || '',
    tipo: p.tipo || 'Plaza de bolsillo',
    votos: Number(p.votos) >= 0 ? Number(p.votos) : 1,
    nombre_usuario: p.nombre_usuario || 'Anónimo',
    estado: p.estado || 'Nueva',
    latitud: p.latitud != null && p.latitud !== '' ? Number(p.latitud) : null,
    longitud: p.longitud != null && p.longitud !== '' ? Number(p.longitud) : null,
    created_at: p.created_at || new Date().toISOString(),
    usuario_id: p.usuario_id != null ? String(p.usuario_id) : null,
  };
}

function setUsuario(usuario) {
  Store.usuario = usuario;
  persistUsuario();
  syncVotosUsuarioFromStorage();
  syncLikesZonasFromStorage();
  sincronizarLikesZonasConServidor();
  renderAuthUI();
  renderAll();
  refrescarEstadoBan();
  // Google puede cargar async; reintentar init del botón
  window.addEventListener('load', () => setTimeout(inicializarGoogleButton, 300));
  setTimeout(inicializarGoogleButton, 800);
}

/**
 * Callback de Google Identity Services (data-callback en index.html).
 * Recibe el credential JWT con tu nombre y email reales de Google.
 */
async function manejarRespuestaGoogle(response) {
  if (!response || !response.credential) {
    alert('No se recibió credencial de Google. Revisá el Client ID.');
    return;
  }

  const payload = decodeJwtPayload(response.credential);
  if (!payload || !payload.sub) {
    alert('No se pudo leer el token de Google.');
    return;
  }

  // Datos reales de tu cuenta Google
  const perfil = {
    google_id: String(payload.sub),
    email: payload.email || '',
    nombre: payload.name || payload.given_name || payload.email || 'Usuario Google',
    picture: payload.picture || null,
    credential: response.credential,
  };

  // Registrar / sincronizar en el servidor (si está corriendo)
  let usuarioId = perfil.google_id;
  try {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: response.credential,
        google_id: perfil.google_id,
        email: perfil.email,
        nombre: perfil.nombre,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.id) usuarioId = String(data.id);
      if (data && data.nombre) perfil.nombre = data.nombre;
      if (data && data.email) perfil.email = data.email;
    }
  } catch (_) {
    /* sin API: sesión solo en el navegador, con datos reales de Google */
  }

  setUsuario({
    id: String(usuarioId),
    nombre: perfil.nombre,
    email: perfil.email,
    google_id: perfil.google_id,
    picture: perfil.picture,
  });
  cerrarModalLogin();
}

/** Decodifica el payload del JWT de Google (solo lectura; la verificación seria va en el server). */
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(
      json.split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    ));
  } catch {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }
}

/** Inicializa el botón de Google cuando el modal se abre (por si el script GSI cargó tarde). */
function inicializarGoogleButton() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('PEGAR_AQUI')) {
    console.warn('Configurá GOOGLE_CLIENT_ID en script.js e index.html');
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: manejarRespuestaGoogle,
      context: 'signin',
      ux_mode: 'popup',
      auto_select: false,
    });
    const wrap = document.getElementById('googleBtnWrap');
    if (wrap) {
      // Limpiar renders previos y volver a pintar el botón
      const host = document.createElement('div');
      host.id = 'g_id_signin_host';
      wrap.querySelectorAll('#g_id_signin_host, .g_id_signin').forEach((n) => n.remove());
      wrap.appendChild(host);
      google.accounts.id.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
      });
    }
    const hint = document.getElementById('googleConfigHint');
    if (hint) hint.classList.add('hidden');
  } catch (e) {
    console.error('Error inicializando Google Sign-In:', e);
  }
}

function cerrarSesion() {
  setUsuario(null);
}

function abrirModalLogin() {
  document.getElementById('modalLogin')?.classList.add('active');
  // Asegurar que el botón de Google se renderice al abrir
  setTimeout(inicializarGoogleButton, 50);
}

function cerrarModalLogin() {
  document.getElementById('modalLogin')?.classList.remove('active');
}

function renderAuthUI() {
  const nav = document.getElementById('navAuth');
  const banner = document.getElementById('authRequiredBanner');
  const campos = document.getElementById('formPropuestaCampos');
  if (!nav) return;

  if (Store.usuario) {
    const avatar = Store.usuario.picture
      ? `<img class="nav-avatar" src="${escapeHtml(Store.usuario.picture)}" alt="" referrerpolicy="no-referrer">`
      : '';
    const modBtn = esModerador()
      ? `<button type="button" class="btn-mod" onclick="abrirModalModeracion()" title="Panel de moderación">⚖️ Mod</button>`
      : '';
    nav.innerHTML = `
      <div class="nav-user">
        ${modBtn}
        ${avatar}
        <span class="nav-user-name" title="${escapeHtml(Store.usuario.email)}">${escapeHtml(Store.usuario.nombre)}</span>
        <button type="button" class="btn-auth btn-auth-out" onclick="cerrarSesion()">Salir</button>
      </div>`;
    banner?.classList.add('hidden');
    campos?.classList.remove('form-bloqueado');
  } else {
    nav.innerHTML = `
      <button type="button" class="btn-auth" onclick="abrirModalLogin()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Ingresar
      </button>`;
    banner?.classList.remove('hidden');
    campos?.classList.add('form-bloqueado');
  }
}

async function votarPropuesta(id) {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return { ok: false, reason: 'auth' };
  }

  const pid = String(id);
  const p = select.propuestaById(pid);
  if (!p) return { ok: false, reason: 'not_found' };

  const bodyUser = {
    usuario_id: Store.usuario.id,
    email: Store.usuario.email,
    google_id: Store.usuario.google_id,
  };

  // Si ya votó → desvotar
  if (select.yaVoto(pid)) {
    p.votos = Math.max(0, (p.votos || 1) - 1);
    quitarVotoLocal(pid);
    persistPropuestas();
    try {
      const res = await fetch(`${API_BASE}/api/propuestas/${encodeURIComponent(pid)}/desvotar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyUser),
      });
      if (res.ok) {
        const saved = await res.json();
        if (saved && typeof saved.votos === 'number') p.votos = saved.votos;
        persistPropuestas();
      }
    } catch (_) {}
    renderAll();
    return { ok: true, unvoted: true, propuesta: p };
  }

  // Votar
  p.votos = (p.votos || 0) + 1;
  persistVoto(pid);
  persistPropuestas();

  try {
    const res = await fetch(`${API_BASE}/api/propuestas/${encodeURIComponent(pid)}/votar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyUser),
    });
    if (res.ok) {
      const saved = await res.json();
      if (saved && typeof saved.votos === 'number') p.votos = saved.votos;
      persistPropuestas();
    }
  } catch (_) {}

  renderAll();
  return { ok: true, propuesta: p };
}

async function eliminarPropuesta(id) {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return;
  }
  const pid = String(id);
  const p = select.propuestaById(pid);
  if (!p) return;
  if (!esPropuestaMia(p)) {
    alert('Solo podés eliminar tus propias propuestas.');
    return;
  }
  if (!confirm('¿Eliminar esta propuesta? Esta acción no se puede deshacer.')) return;

  Store.propuestas = Store.propuestas.filter((x) => String(x.id) !== pid);
  quitarVotoLocal(pid);
  persistPropuestas();

  try {
    await fetch(`${API_BASE}/api/propuestas/${encodeURIComponent(pid)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: Store.usuario.id,
        email: Store.usuario.email,
        google_id: Store.usuario.google_id,
      }),
    });
  } catch (_) {}

  cerrarMenusPropuesta();
  renderAll();
}

async function denunciarPropuesta(id) {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return;
  }
  const pid = String(id);
  const p = select.propuestaById(pid);
  if (!p) return;
  if (esPropuestaMia(p)) {
    alert('No podés denunciar tu propia propuesta. Si te equivocaste, eliminála.');
    return;
  }
  if (yaDenuncie(pid)) {
    alert('Ya denunciaste esta propuesta. Gracias, el equipo la revisará.');
    cerrarMenusPropuesta();
    return;
  }

  const motivo = prompt(
    '¿Por qué denunciás esta propuesta?\n(Ej: contenido ofensivo, spam, datos falsos, fuera de tema)',
    ''
  );
  if (motivo === null) return; // canceló
  const motivoTrim = (motivo || '').trim() || 'Sin motivo especificado';

  marcarDenunciaLocal(pid, motivoTrim);

  try {
    await fetch(`${API_BASE}/api/propuestas/${encodeURIComponent(pid)}/denunciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: Store.usuario.id,
        email: Store.usuario.email,
        google_id: Store.usuario.google_id,
        motivo: motivoTrim,
      }),
    });
  } catch (_) {}

  cerrarMenusPropuesta();
  alert('Denuncia registrada. Gracias por ayudar a cuidar la comunidad.');
  renderAll();
}

function toggleMenuPropuesta(btn, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const menu = btn.parentElement.querySelector('.pcard-menu');
  const wasOpen = menu && menu.classList.contains('open');
  cerrarMenusPropuesta();
  if (menu && !wasOpen) menu.classList.add('open');
}

function cerrarMenusPropuesta() {
  document.querySelectorAll('.pcard-menu.open').forEach((m) => m.classList.remove('open'));
}

function upsertPropuesta(raw) {
  const p = normalizePropuesta(raw);
  const idx = Store.propuestas.findIndex((x) => String(x.id) === p.id);
  if (idx >= 0) Store.propuestas[idx] = { ...Store.propuestas[idx], ...p };
  else Store.propuestas.unshift(p);
  persistPropuestas();
  return p;
}

async function crearPropuesta(datos) {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return null;
  }
  await refrescarEstadoBan();
  if (usuarioEstaBaneado()) {
    actualizarBannerBan();
    const tiempo = textoTiempoRestanteBan(Store.usuario.baneado_hasta);
    alert(`Estás baneado por ${tiempo || 'un tiempo'}, por favor, retírese y vuelva a intentarlo más tarde.`);
    return null;
  }

  const { titulo, direccion, descripcion, tipo, latitud, longitud } = datos;
  if (!titulo || !direccion) {
    alert('Completá al menos la dirección y el título.');
    return null;
  }
  if (latitud == null || longitud == null || Number.isNaN(latitud) || Number.isNaN(longitud)) {
    alert('Elegí la ubicación en el mapa con el botón «Elegir en el mapa».');
    return null;
  }

  const draft = normalizePropuesta({
    id: 'local_' + Date.now().toString(36),
    titulo,
    direccion,
    descripcion,
    tipo,
    votos: 1,
    nombre_usuario: Store.usuario.nombre,
    estado: 'Nueva',
    latitud,
    longitud,
    created_at: new Date().toISOString(),
    usuario_id: Store.usuario.id,
  });

  persistVoto(draft.id);

  try {
    const res = await fetch(`${API_BASE}/api/propuestas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, usuario: Store.usuario }),
    });
    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      if (err.baneado_hasta) {
        Store.usuario.baneado_hasta = err.baneado_hasta;
        actualizarBannerBan();
      }
      const tiempo = textoTiempoRestanteBan(err.baneado_hasta || Store.usuario?.baneado_hasta);
      alert(err.error || `Estás baneado por ${tiempo || 'un tiempo'}, por favor, retírese y vuelva a intentarlo más tarde.`);
      return null;
    }
    if (res.ok) {
      const saved = await res.json();
      if (saved?.id) {
        const oldId = draft.id;
        draft.id = String(saved.id);
        if (typeof saved.votos === 'number') draft.votos = saved.votos;
        if (Store.votosUsuario.has(oldId)) {
          Store.votosUsuario.delete(oldId);
          persistVoto(draft.id);
        }
      }
    }
  } catch (_) {}

  upsertPropuesta(draft);
  clearMarcadorTemporal();
  renderAll();
  return draft;
}

function crearIcono(tipo, simbolo = '') {
  return L.divIcon({
    className: '',
    html: `<div class="mapa-marcador ${tipo}">${simbolo}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function popupPropuestaHTML(p) {
  const voted = select.yaVoto(p.id);
  return `
    <strong>${escapeHtml(p.titulo)}</strong><br>
    <span style="font-size:0.75rem;color:#4A5568">${escapeHtml(p.direccion)}</span>
    <div class="popup-votos">
      <button type="button" class="votar-btn ${voted ? 'voted' : ''}"
        onclick="votarPropuesta('${escapeHtml(p.id)}')"
        title="${voted ? 'Quitar tu voto' : 'Sumar un voto'}">↑</button>
      <span>${p.votos} voto${p.votos === 1 ? '' : 's'}</span>
    </div>
    <button type="button" class="popup-vermas-btn" onclick="abrirDetallePropuesta('${escapeHtml(p.id)}')">Ver más información →</button>
  `;
}

function popupFichaHTML(f, tipo) {
  return `
    <strong>${escapeHtml(f.titulo)}</strong><br>
    <span style="font-size:0.75rem;color:#4A5568">${escapeHtml(f.resumen)}</span>
    ${tipo === 'verde' ? `<div class="popup-like">${botonLikeZonaHTML(f)}</div>` : ''}
    <button type="button" class="popup-vermas-btn" onclick="abrirDetalleFicha('${tipo}', '${escapeHtml(f.id)}')">Ver más información →</button>
  `;
}

function clearMarcadoresPropuestas() {
  Object.values(Store.marcadores).forEach((m) => {
    try { Store.capas.prop?.removeLayer(m); } catch (_) {}
  });
  Store.marcadores = {};
}

function clearMarcadorTemporal() {
  if (Store.marcadorTemporal && Store.mapa) {
    try { Store.mapa.removeLayer(Store.marcadorTemporal); } catch (_) {}
  }
  Store.marcadorTemporal = null;
}

function syncMarcadoresDesdeStore() {
  clearMarcadoresPropuestas();
  if (!Store.capas.prop) return;
  select.propuestasActivas().forEach((p) => {
    if (p.latitud == null || p.longitud == null) return;
    const marker = L.marker([p.latitud, p.longitud], { icon: crearIcono('prop', '★') })
      .bindPopup(popupPropuestaHTML(p))
      .addTo(Store.capas.prop);
    Store.marcadores[p.id] = marker;
  });
}

function inicializarMapa() {
  Store.mapa = L.map('map').setView(CENTRO_SAN_TELMO, 15);
  L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=c016fa8b-688d-42ab-bde9-1159cfe1a15d', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(Store.mapa);

  Store.capas.verde = L.layerGroup().addTo(Store.mapa);
  Store.capas.calor = L.layerGroup().addTo(Store.mapa);
  Store.capas.prop = L.layerGroup().addTo(Store.mapa);

  syncMarcadoresZonasDesdeStore(); // (las zonas ya vienen cargadas desde init)

  Store.mapa.on('click', onMapClick);
}

function syncMarcadoresZonasDesdeStore() {
  Object.values(Store.marcadoresVerde).forEach((m) => { try { Store.capas.verde?.removeLayer(m); } catch (_) {} });
  Object.values(Store.marcadoresCalor).forEach((m) => { try { Store.capas.calor?.removeLayer(m); } catch (_) {} });
  Store.marcadoresVerde = {};
  Store.marcadoresCalor = {};
  if (!Store.capas.verde || !Store.capas.calor) return;

  ESPACIOS_VERDES.forEach((f) => {
    Store.marcadoresVerde[f.id] = L.marker([f.lat, f.lng], { icon: crearIcono('verde', f.simbolo || '') })
      .bindPopup(popupFichaHTML(f, 'verde'))
      .addTo(Store.capas.verde);
  });
  ISLAS_CALOR.forEach((f) => {
    Store.marcadoresCalor[f.id] = L.marker([f.lat, f.lng], { icon: crearIcono('calor', '!') })
      .bindPopup(popupFichaHTML(f, 'calor'))
      .addTo(Store.capas.calor);
  });
}

function onMapClick(e) {
  if (!Store.modoUbicacion || !Store.mapa) return;
  const { lat, lng } = e.latlng;
  const destino = Store.modoUbicacionDestino || 'propuesta';
  clearMarcadorTemporal();
  Store.marcadorTemporal = L.marker([lat, lng], { icon: crearIcono('prop', '★') }).addTo(Store.mapa);
  cancelarModoUbicacion();

  if (destino === 'zona') {
    // El moderador estaba cargando una zona: volvemos a su panel con la ubicación lista.
    document.getElementById('modZonaLat').value = lat.toFixed(6);
    document.getElementById('modZonaLng').value = lng.toFixed(6);
    const textoMod = document.getElementById('modZonaUbicacionTexto');
    if (textoMod) {
      textoMod.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      textoMod.classList.add('marcada');
    }
    abrirModalModeracion();
    cambiarTabMod(document.querySelector('.mod-tab[data-tab="zonas"]'));
    return;
  }

  document.getElementById('inputLat').value = lat.toFixed(6);
  document.getElementById('inputLng').value = lng.toFixed(6);
  const texto = document.getElementById('ubicacionTexto');
  if (texto) {
    texto.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    texto.classList.add('marcada');
  }
  mostrarVista('propuestas'); // volvemos al formulario con la ubicación ya cargada
}

function activarModoUbicacion() {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return;
  }
  Store.modoUbicacion = true;
  document.getElementById('modoUbicacionBanner')?.classList.remove('hidden');
  document.getElementById('map')?.classList.add('cursor-crosshair');
  mostrarVista('mapa');
}

function textoBannerUbicacion(t) {
  const el = document.getElementById('modoUbicacionTexto');
  if (el) el.textContent = t;
}

function cancelarModoUbicacion() {
  Store.modoUbicacion = false;
  Store.modoUbicacionDestino = 'propuesta';
  textoBannerUbicacion('📍 Hacé clic en el mapa para marcar la ubicación de tu propuesta');
  document.getElementById('modoUbicacionBanner')?.classList.add('hidden');
  document.getElementById('map')?.classList.remove('cursor-crosshair');
}

function filtrar(tipo, boton) {
  Store.filtros[tipo] = !Store.filtros[tipo];
  boton.classList.toggle('active', Store.filtros[tipo]);
  const capa = Store.capas[tipo];
  if (!capa || !Store.mapa) return;
  if (Store.filtros[tipo]) capa.addTo(Store.mapa);
  else Store.mapa.removeLayer(capa);
}

function tarjetaPropuestaHTML(p) {
  const voted = select.yaVoto(p.id);
  const mia = esPropuestaMia(p);
  const denunciada = yaDenuncie(p.id);
  const menuItems = mia
    ? `<button type="button" class="pcard-menu-item danger" onclick="eliminarPropuesta('${escapeHtml(p.id)}')">🗑️ Eliminar propuesta</button>`
    : `<button type="button" class="pcard-menu-item" onclick="denunciarPropuesta('${escapeHtml(p.id)}')" ${denunciada ? 'disabled' : ''}>
         🚩 ${denunciada ? 'Ya denunciada' : 'Denunciar'}
       </button>`;

  return `
    <div class="propuesta-card" data-id="${escapeHtml(p.id)}">
      <div class="pcard-header">
        <span class="pcard-tipo">${escapeHtml(p.tipo)}</span>
        <div class="pcard-actions">
          <div class="pcard-votos">
            <button type="button" class="votar-btn ${voted ? 'voted' : ''}"
              onclick="votarPropuesta('${escapeHtml(p.id)}')"
              title="${voted ? 'Quitar tu voto' : 'Sumar un voto'}">↑</button>
            <span class="voto-count">${p.votos}</span>
          </div>
          <div class="pcard-menu-wrap">
            <button type="button" class="pcard-menu-btn" aria-label="Más opciones"
              onclick="toggleMenuPropuesta(this, event)">⋯</button>
            <div class="pcard-menu">${menuItems}</div>
          </div>
        </div>
      </div>
      <div class="pcard-titulo">${escapeHtml(p.titulo)} — ${escapeHtml(p.direccion)}</div>
      <div class="pcard-desc">${escapeHtml(p.descripcion || 'Sin descripción adicional.')}</div>
      <div class="pcard-footer">
        <span class="pcard-usuario">${escapeHtml(p.nombre_usuario)} · ${formatearFecha(p.created_at)}</span>
        <span class="pcard-estado ${estadoClass(p.estado)}">${escapeHtml(p.estado || 'Nueva')}</span>
      </div>
      ${p.latitud != null && p.longitud != null
        ? `<button type="button" class="pcard-ver-mapa" onclick="irAMapa(${p.latitud}, ${p.longitud}, 'prop', '${escapeHtml(p.id)}')">📍 Ver en el mapa</button>`
        : ''}
    </div>
  `;
}

// ——— Buscador de propuestas ———
const FiltroProp = { texto: '', tipo: '' };

// Minúsculas y sin tildes: "plaza" encuentra "Plaza", "jardin" encuentra "Jardín"
function normalizarBusqueda(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function propuestaCoincide(p) {
  if (FiltroProp.tipo && p.tipo !== FiltroProp.tipo) return false;
  const terminos = normalizarBusqueda(FiltroProp.texto).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return true;
  const pajar = normalizarBusqueda([p.titulo, p.direccion, p.descripcion, p.nombre_usuario, p.tipo, p.estado].join(' '));
  return terminos.every((t) => pajar.includes(t)); // deben aparecer todas las palabras
}

function limpiarBuscador() {
  FiltroProp.texto = '';
  FiltroProp.tipo = '';
  const inp = document.getElementById('buscadorPropuestas');
  const sel = document.getElementById('buscadorTipo');
  if (inp) inp.value = '';
  if (sel) sel.value = '';
  document.getElementById('buscadorLimpiar')?.classList.add('hidden');
  renderListaPropuestas();
}

function activarBuscador() {
  const inp = document.getElementById('buscadorPropuestas');
  const sel = document.getElementById('buscadorTipo');
  const btn = document.getElementById('buscadorLimpiar');
  if (!inp || !sel) return;
  inp.addEventListener('input', () => {
    FiltroProp.texto = inp.value;
    btn?.classList.toggle('hidden', !inp.value);
    renderListaPropuestas();
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') limpiarBuscador(); });
  sel.addEventListener('change', () => { FiltroProp.tipo = sel.value; renderListaPropuestas(); });
  btn?.addEventListener('click', () => { limpiarBuscador(); inp.focus(); });
}

function cambiarTabLista(tab) {
  Store.tabLista = tab;
  document.querySelectorAll('.lista-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const controles = document.getElementById('propuestasControles');
  const label = document.getElementById('fichasLabel');
  if (controles) controles.classList.toggle('hidden', tab !== 'propuestas');
  if (label) label.classList.toggle('hidden', tab === 'propuestas');
  renderListaPropuestas();
}

function actualizarContadoresTabs() {
  const cp = document.getElementById('contadorTabProp');
  const cv = document.getElementById('contadorTabVerde');
  const cc = document.getElementById('contadorTabCalor');
  if (cp) cp.textContent = String(select.propuestasActivas().length);
  if (cv) cv.textContent = String(ESPACIOS_VERDES.length);
  if (cc) cc.textContent = String(ISLAS_CALOR.length);
}

// Resalta y centra en pantalla una tarjeta ya renderizada (usado al venir
// desde "Ver detalladamente" en el mapa, para mostrarla en contexto entre
// las demás en vez de abrir un modal aislado).
function resaltarTarjetaEnLista(id) {
  const tarjeta = document.querySelector(`#propuestasList .propuesta-card[data-id="${CSS.escape(String(id))}"]`);
  if (!tarjeta) return;
  tarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  tarjeta.classList.add('pcard-resaltada');
  setTimeout(() => tarjeta.classList.remove('pcard-resaltada'), 1700);
}

function renderListaFichas(tipo) {
  const lista = document.getElementById('propuestasList');
  const label = document.getElementById('fichasLabel');
  if (!lista) return;
  const datos = tipo === 'verde' ? verdesPorLikes() : ISLAS_CALOR;
  const icono = tipo === 'verde' ? '🌳' : '🌡️';
  if (label) {
    label.textContent = tipo === 'verde'
      ? `Espacios verdes existentes · ${datos.length} registrados · ordenados por me gusta`
      : `Islas de calor relevadas · ${datos.length} registradas`;
  }
  lista.innerHTML = datos.map((f) => `
    <div class="propuesta-card ficha-card panel-card ${tipo === 'calor' ? 'calor' : ''}" data-id="${escapeHtml(f.id)}">
      <h4>${icono} ${escapeHtml(f.titulo)}</h4>
      <p>${escapeHtml(f.detalle)}</p>
      <span class="tag">${escapeHtml(f.resumen)}</span>
      <div class="ficha-footer">
        <button type="button" class="pcard-ver-mapa" onclick="irAMapa(${f.lat}, ${f.lng}, '${tipo}', '${escapeHtml(f.id)}')">📍 Ver en el mapa</button>
        ${tipo === 'verde' ? botonLikeZonaHTML(f) : ''}
      </div>
    </div>`).join('');
  if (!datos.length) lista.innerHTML = '<p style="font-size:0.85rem;color:var(--pizarra-claro)">Todavía no hay zonas cargadas.</p>';
}

function renderListaPropuestas() {
  actualizarContadoresTabs();
  const tab = Store.tabLista || 'propuestas';
  if (tab === 'verde' || tab === 'calor') {
    renderListaFichas(tab);
    if (Store.resaltarAlRenderizar && Store.resaltarAlRenderizar.tipo === tab) {
      const { id } = Store.resaltarAlRenderizar;
      Store.resaltarAlRenderizar = null;
      setTimeout(() => resaltarTarjetaEnLista(id), 150);
    }
    return;
  }

  const lista = document.getElementById('propuestasList');
  const contador = document.getElementById('contadorProp');
  const statP = document.getElementById('statPropuestas');
  const resumen = document.getElementById('buscadorResumen');
  const activas = select.propuestasActivas();
  if (contador) contador.textContent = String(activas.length);
  if (statP) statP.textContent = String(activas.length);
  if (!lista) return;
  if (activas.length === 0) {
    if (resumen) resumen.textContent = '';
    lista.innerHTML = `
      <div class="empty-propuestas" id="emptyPropuestas">
        <p>Todavía no hay propuestas. Sé el primero en proponer un espacio verde en el barrio.</p>
      </div>`;
    return;
  }
  const filtrando = Boolean(FiltroProp.texto.trim() || FiltroProp.tipo);
  const visibles = activas.filter(propuestaCoincide);
  if (resumen) {
    resumen.textContent = filtrando
      ? `Mostrando ${visibles.length} de ${activas.length} propuestas`
      : '';
  }
  if (visibles.length === 0) {
    const q = FiltroProp.texto.trim();
    lista.innerHTML = `
      <div class="sin-resultados">
        <p>No encontramos propuestas${q ? ` para «${escapeHtml(q)}»` : ''}${FiltroProp.tipo ? ` de tipo ${escapeHtml(FiltroProp.tipo)}` : ''}.<br>Probá con otras palabras o quitá los filtros.</p>
        <button type="button" class="btn-primary btn-sm" onclick="limpiarBuscador()">Limpiar búsqueda</button>
      </div>`;
    return;
  }
  const ordenadas = [...visibles].sort((a, b) => (b.votos || 0) - (a.votos || 0));
  lista.innerHTML = ordenadas.map(tarjetaPropuestaHTML).join('');

  if (Store.resaltarAlRenderizar && Store.resaltarAlRenderizar.tipo === 'propuestas') {
    const { id } = Store.resaltarAlRenderizar;
    Store.resaltarAlRenderizar = null;
    setTimeout(() => resaltarTarjetaEnLista(id), 150);
  }
}

function renderPanelLateral() {
  const panel = document.getElementById('mapaPanel');
  if (!panel) return;
  let html = verdesPorLikes().slice(0, 2).map((f) => `
    <div class="panel-card" onclick="abrirDetalleFicha('verde', '${f.id}')" style="cursor:pointer">
      <h4>🌳 ${escapeHtml(f.titulo)}</h4>
      <p>${escapeHtml(f.detalle)}</p>
      <span class="tag">ACTIVO · ${escapeHtml(f.resumen)} · 💚 ${f.likes || 0}</span>
    </div>`).join('');
  const top = select.topPropuestas(3);
  if (top.length === 0) {
    html += `
      <div class="panel-card panel-empty">
        <h4>📍 Propuestas ciudadanas</h4>
        <p>Aún no hay propuestas publicadas. Cuando la comunidad cargue ideas, aparecerán aquí y en el mapa.</p>
      </div>`;
  } else {
    top.forEach((p) => {
      html += `
        <div class="panel-card propuesta">
          <h4>★ ${escapeHtml(p.titulo)}</h4>
          <p>${escapeHtml((p.descripcion || '').slice(0, 120))}${(p.descripcion || '').length > 120 ? '…' : ''}</p>
          <span class="tag">${p.votos} VOTO${p.votos === 1 ? '' : 'S'} · ${(p.estado || 'NUEVA').toUpperCase()}</span>
        </div>`;
    });
  }
  html += `
    <button type="button" class="btn-ver-mas" onclick="abrirModalTotal()">
      Ver más fichas y propuestas…
    </button>`;
  panel.innerHTML = html;
}

function renderAll() {
  renderListaPropuestas();
  renderPanelLateral();
  syncMarcadoresZonasDesdeStore();
  syncMarcadoresDesdeStore();
}

function selectTipo(boton) {
  document.querySelectorAll('.tipo-btn').forEach((b) => b.classList.remove('selected'));
  boton.classList.add('selected');
}

async function enviarPropuesta() {
  const tipoBtn = document.querySelector('.tipo-btn.selected');
  const latRaw = document.getElementById('inputLat')?.value;
  const lngRaw = document.getElementById('inputLng')?.value;
  const creada = await crearPropuesta({
    titulo: (document.getElementById('inputTitulo')?.value || '').trim(),
    direccion: (document.getElementById('inputDireccion')?.value || '').trim(),
    descripcion: (document.getElementById('inputDesc')?.value || '').trim(),
    tipo: tipoBtn?.dataset?.tipo || tipoBtn?.textContent?.trim() || 'Plaza de bolsillo',
    latitud: latRaw ? parseFloat(latRaw) : null,
    longitud: lngRaw ? parseFloat(lngRaw) : null,
  });
  if (!creada) return;
  document.getElementById('inputTitulo').value = '';
  document.getElementById('inputDireccion').value = '';
  document.getElementById('inputDesc').value = '';
  document.getElementById('inputLat').value = '';
  document.getElementById('inputLng').value = '';
  const ut = document.getElementById('ubicacionTexto');
  if (ut) {
    ut.textContent = 'Sin marcar';
    ut.classList.remove('marcada');
  }
  const card = document.querySelector(`.propuesta-card[data-id="${creada.id}"]`);
  if (card) {
    card.classList.add('propuesta-nueva-flash');
    setTimeout(() => card.classList.remove('propuesta-nueva-flash'), 1200);
  }
}

const ModalFiltro = { texto: '', tipo: '', zona: '' };

function abrirModalTotal(seccion) {
  const modal = document.getElementById('modalTotal');
  const content = document.getElementById('modalBodyContent');
  if (!modal || !content) return;
  if (seccion && seccion !== Store.modalSeccion) {
    // al cambiar de menú se limpia el filtro de tipo (cada menú tiene el suyo)
    ModalFiltro.tipo = '';
    ModalFiltro.zona = '';
  }
  if (seccion) Store.modalSeccion = seccion;
  const sec = Store.modalSeccion || 'propuestas';
  const activas = select.propuestasActivas();
  const opciones = sec === 'propuestas'
    ? `<option value="">Todos los tipos</option>
       <option value="Plaza de bolsillo">🌳 Plaza de bolsillo</option>
       <option value="Techo verde">🌿 Techo verde</option>
       <option value="Jardín comunitario">🌻 Jardín comunitario</option>
       <option value="Arbolado urbano">🌲 Arbolado urbano</option>`
    : `<option value="">Todas las zonas</option>
       <option value="verde">🌳 Espacios verdes</option>
       <option value="calor">🌡️ Islas de calor</option>`;
  const placeholder = sec === 'propuestas'
    ? 'Buscar por título, dirección, descripción o autor…'
    : 'Buscar espacios verdes e islas de calor…';
  content.innerHTML = `
    <div class="lista-header" role="tablist" aria-label="Menú del directorio">
      <button type="button" class="lista-tab ${sec === 'propuestas' ? 'active' : ''}" role="tab" aria-selected="${sec === 'propuestas'}" onclick="abrirModalTotal('propuestas')">📋 Solo propuestas <span>${activas.length}</span></button>
      <button type="button" class="lista-tab ${sec === 'zonas' ? 'active' : ''}" role="tab" aria-selected="${sec === 'zonas'}" onclick="abrirModalTotal('zonas')">🌳🌡️ Zonas verdes e islas de calor <span>${ESPACIOS_VERDES.length + ISLAS_CALOR.length}</span></button>
    </div>
    <div class="buscador-prop" role="search">
      <div class="buscador-input-wrap">
        <span class="buscador-ico" aria-hidden="true">🔍</span>
        <input type="text" id="modalBuscador" placeholder="${placeholder}" aria-label="Buscar en el directorio" autocomplete="off">
        <button type="button" id="modalLimpiar" class="buscador-limpiar hidden" aria-label="Borrar búsqueda">×</button>
      </div>
      <select id="modalTipo" aria-label="Filtrar">${opciones}</select>
    </div>
    <div id="modalResumen" class="buscador-resumen" aria-live="polite"></div>
    <div id="modalResultados"></div>`;

  const inp = document.getElementById('modalBuscador');
  const sel = document.getElementById('modalTipo');
  const btn = document.getElementById('modalLimpiar');
  const valorSel = sec === 'propuestas' ? ModalFiltro.tipo : ModalFiltro.zona;
  inp.value = ModalFiltro.texto;
  sel.value = valorSel;
  btn.classList.toggle('hidden', !inp.value);
  inp.addEventListener('input', () => {
    ModalFiltro.texto = inp.value;
    btn.classList.toggle('hidden', !inp.value);
    renderResultadosModal();
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.value = ''; inp.dispatchEvent(new Event('input')); } });
  sel.addEventListener('change', () => {
    if (sec === 'propuestas') ModalFiltro.tipo = sel.value; else ModalFiltro.zona = sel.value;
    renderResultadosModal();
  });
  btn.addEventListener('click', () => { inp.value = ''; inp.dispatchEvent(new Event('input')); inp.focus(); });

  renderResultadosModal();
  content.scrollTop = 0;
  modal.classList.add('active');
}

function renderResultadosModal() {
  const cont = document.getElementById('modalResultados');
  const resumen = document.getElementById('modalResumen');
  if (!cont) return;
  const sec = Store.modalSeccion || 'propuestas';
  const terminos = normalizarBusqueda(ModalFiltro.texto).split(/\s+/).filter(Boolean);
  const coincide = (txt) => terminos.every((t) => normalizarBusqueda(txt).includes(t));
  const sinResultados = '<p style="font-size:0.85rem;color:var(--pizarra-claro)">No encontramos resultados. Probá con otras palabras o quitá los filtros.</p>';
  let html = '';
  let total = 0;
  let mostrados = 0;

  if (sec === 'propuestas') {
    const activas = select.propuestasActivas();
    total = activas.length;
    const visibles = activas.filter((p) => {
      if (ModalFiltro.tipo && p.tipo !== ModalFiltro.tipo) return false;
      return coincide([p.titulo, p.direccion, p.descripcion, p.nombre_usuario, p.tipo, p.estado].join(' '));
    });
    mostrados = visibles.length;
    html += '<div class="modal-section-title">Propuestas ciudadanas</div>';
    if (total === 0) html += '<p style="font-size:0.85rem;color:var(--pizarra-claro)">No hay propuestas registradas todavía.</p>';
    else if (mostrados === 0) html += sinResultados;
    else visibles.forEach((p) => { html += `<div style="margin-bottom:0.5rem">${tarjetaPropuestaHTML(p)}</div>`; });
  } else {
    const grupos = [
      { tipo: 'verde', titulo: 'Espacios verdes existentes', icono: '🌳', datos: verdesPorLikes() },
      { tipo: 'calor', titulo: 'Islas de calor', icono: '🌡️', datos: ISLAS_CALOR },
    ];
    total = ESPACIOS_VERDES.length + ISLAS_CALOR.length;
    let primero = true;
    grupos.forEach((g) => {
      if (ModalFiltro.zona && ModalFiltro.zona !== g.tipo) return;
      const visibles = g.datos.filter((f) => coincide([f.titulo, f.resumen, f.detalle].join(' ')));
      if (visibles.length === 0) return;
      mostrados += visibles.length;
      html += `<div class="modal-section-title"${primero ? '' : ' style="margin-top:1.5rem"'}>${g.titulo}</div>`;
      primero = false;
      html += visibles.map((f) => `
        <div class="panel-card ${g.tipo === 'calor' ? 'calor' : ''}" data-id="${escapeHtml(f.id)}" style="margin-bottom:0.5rem">
          <h4>${g.icono} ${escapeHtml(f.titulo)}</h4><p>${escapeHtml(f.detalle || f.resumen)}</p><span class="tag">${escapeHtml(f.resumen)}</span>
          <div class="ficha-footer">
            <button type="button" class="pcard-ver-mapa" onclick="irAMapa(${f.lat}, ${f.lng}, '${g.tipo}', '${escapeHtml(f.id)}')">📍 Ver en el mapa</button>
            ${g.tipo === 'verde' ? botonLikeZonaHTML(f) : ''}
          </div>
        </div>`).join('');
    });
    if (mostrados === 0) html = sinResultados;
  }
  const filtrando = Boolean(terminos.length || (sec === 'propuestas' ? ModalFiltro.tipo : ModalFiltro.zona));
  if (resumen) resumen.textContent = filtrando ? `Mostrando ${mostrados} de ${total}` : '';
  cont.innerHTML = html;
}

function cerrarModalTotal() {
  document.getElementById('modalTotal')?.classList.remove('active');
}

// ── Detalle de una ficha o propuesta (desde el marcador del mapa, "Ver más") ──

function abrirDetalle(titulo, html) {
  const modal = document.getElementById('modalDetalle');
  const tituloEl = document.getElementById('modalDetalleTitulo');
  const content = document.getElementById('modalDetalleContent');
  if (!modal || !content) return;
  if (tituloEl) tituloEl.textContent = titulo;
  content.innerHTML = html;
  modal.classList.add('active');
}

function cerrarModalDetalle() {
  document.getElementById('modalDetalle')?.classList.remove('active');
}

// "Ver más información" desde el mapa (o desde el panel lateral): abre el
// directorio de tarjetas cargadas en el menú que corresponde (propuestas o
// zonas verdes e islas de calor) y resalta la tarjeta entre las demás.
function abrirDirectorioEn(seccion, id) {
  cerrarModalDetalle();
  ModalFiltro.texto = '';
  ModalFiltro.tipo = '';
  ModalFiltro.zona = '';
  Store.modalSeccion = seccion;
  abrirModalTotal(seccion);
  setTimeout(() => {
    const tarjeta = document.querySelector(`#modalResultados [data-id="${CSS.escape(String(id))}"]`);
    if (!tarjeta) return;
    tarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tarjeta.classList.add('pcard-resaltada');
    setTimeout(() => tarjeta.classList.remove('pcard-resaltada'), 1700);
  }, 150);
}

function abrirDetallePropuesta(id) {
  const p = Store.propuestas.find((x) => String(x.id) === String(id));
  if (!p) return;
  abrirDirectorioEn('propuestas', p.id);
}

function abrirDetalleFicha(tipo, id) {
  const lista = tipo === 'verde' ? ESPACIOS_VERDES : ISLAS_CALOR;
  const f = lista.find((x) => x.id === id);
  if (!f) return;
  abrirDirectorioEn('zonas', f.id);
}

// ── "Ver en el mapa" (desde una tarjeta o ficha de detalle) ──

function irAMapa(lat, lng, tipo, id) {
  cerrarModalDetalle();
  cerrarModalTotal();
  mostrarVista('mapa');
  enfocarMarcador(lat, lng, tipo, id);
}

// Centra el mapa en un marcador, abre su popup y lo resalta.
// Asume que la vista del mapa ya está (o está por estar) visible.
function enfocarMarcador(lat, lng, tipo, id) {
  // Esperamos a que la vista del mapa esté visible y aplicarVista() ya haya
  // corrido su propio invalidateSize() (a los 60ms) antes de centrar,
  // para que Leaflet calcule bien el tamaño del contenedor.
  setTimeout(() => {
    if (!Store.mapa) return;
    Store.mapa.invalidateSize();
    // aplicarVista() sube la página al tope; acá traemos el mapa al centro de la pantalla
    document.querySelector('#mapa .mapa-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    Store.mapa.flyTo([lat, lng], 18, { duration: 0.8 });
    const grupo = tipo === 'prop' ? Store.marcadores : tipo === 'verde' ? Store.marcadoresVerde : Store.marcadoresCalor;
    const marker = grupo[id];
    if (!marker) return;
    setTimeout(() => {
      marker.openPopup();
      const el = marker.getElement();
      if (el) {
        el.classList.add('marcador-resaltado');
        setTimeout(() => el.classList.remove('marcador-resaltado'), 1800);
      }
    }, 850);
  }, 150);
}

// ——— Buscador del mapa ———
// Busca en espacios verdes, islas de calor y propuestas con ubicación.
// Al elegir un resultado, el mapa vuela hasta ahí y abre su popup.
const BuscadorMapa = { resultados: [], activo: -1 };

function itemsBuscablesMapa() {
  const items = [];
  ESPACIOS_VERDES.forEach((f) => items.push({
    tipo: 'verde', id: f.id, lat: f.lat, lng: f.lng, ico: '🌳',
    titulo: f.titulo, sub: f.resumen,
    pajar: normalizarBusqueda([f.titulo, f.resumen, f.detalle, 'espacio verde'].join(' ')),
  }));
  ISLAS_CALOR.forEach((f) => items.push({
    tipo: 'calor', id: f.id, lat: f.lat, lng: f.lng, ico: '🌡️',
    titulo: f.titulo, sub: f.resumen,
    pajar: normalizarBusqueda([f.titulo, f.resumen, f.detalle].join(' ')),
  }));
  select.propuestasActivas()
    .filter((p) => p.latitud != null && p.longitud != null)
    .forEach((p) => items.push({
      tipo: 'prop', id: p.id, lat: p.latitud, lng: p.longitud, ico: '⭐',
      titulo: p.titulo, sub: `Propuesta · ${p.direccion || p.tipo} · ${p.votos} voto${p.votos === 1 ? '' : 's'}`,
      pajar: normalizarBusqueda([p.titulo, p.direccion, p.descripcion, p.tipo, p.nombre_usuario, 'propuesta'].join(' ')),
    }));
  return items;
}

function buscarEnMapa(texto) {
  const terminos = normalizarBusqueda(texto).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return [];
  return itemsBuscablesMapa()
    .filter((it) => terminos.every((t) => it.pajar.includes(t)))
    .map((it) => {
      const tit = normalizarBusqueda(it.titulo);
      return { it, score: terminos.every((t) => tit.includes(t)) ? 2 : 1 }; // título primero
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.it);
}

function cerrarResultadosMapa() {
  const ul = document.getElementById('mapaResultados');
  const inp = document.getElementById('buscadorMapa');
  ul?.classList.add('hidden');
  inp?.setAttribute('aria-expanded', 'false');
  inp?.removeAttribute('aria-activedescendant');
  BuscadorMapa.activo = -1;
}

function marcarResultadoActivo(i) {
  BuscadorMapa.activo = i;
  const inp = document.getElementById('buscadorMapa');
  document.querySelectorAll('#mapaResultados li[data-i]').forEach((li) => {
    const on = Number(li.dataset.i) === i;
    li.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) { inp?.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  });
}

function renderResultadosMapa() {
  const ul = document.getElementById('mapaResultados');
  const inp = document.getElementById('buscadorMapa');
  if (!ul || !inp) return;
  const q = inp.value.trim();
  if (!q) { cerrarResultadosMapa(); return; }
  BuscadorMapa.resultados = buscarEnMapa(q);
  BuscadorMapa.activo = -1;
  ul.innerHTML = BuscadorMapa.resultados.length
    ? BuscadorMapa.resultados.map((r, i) => `
        <li id="mapaRes-${i}" role="option" data-i="${i}" aria-selected="false">
          <span class="res-ico" aria-hidden="true">${r.ico}</span>
          <span class="res-txt">
            <div class="res-titulo">${escapeHtml(r.titulo)}</div>
            <div class="res-sub">${escapeHtml(r.sub)}</div>
          </span>
        </li>`).join('')
    : `<li class="res-vacio">No encontramos nada para «${escapeHtml(q)}» en el mapa.</li>`;
  ul.classList.remove('hidden');
  inp.setAttribute('aria-expanded', 'true');
}

function seleccionarResultadoMapa(i) {
  const r = BuscadorMapa.resultados[i];
  if (!r) return;
  const inp = document.getElementById('buscadorMapa');
  if (inp) inp.value = r.titulo;
  document.getElementById('buscadorMapaLimpiar')?.classList.remove('hidden');
  cerrarResultadosMapa();
  // Si el usuario había apagado esa capa con los filtros, la prendemos
  const btn = document.querySelector(`.filtros-mapa .filtro-btn.${r.tipo}`);
  if (!Store.filtros[r.tipo] && btn) filtrar(r.tipo, btn);
  document.querySelector('.mapa-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  enfocarMarcador(r.lat, r.lng, r.tipo, r.id);
}

function activarBuscadorMapa() {
  const inp = document.getElementById('buscadorMapa');
  const ul = document.getElementById('mapaResultados');
  const btn = document.getElementById('buscadorMapaLimpiar');
  if (!inp || !ul) return;
  inp.addEventListener('input', () => {
    btn?.classList.toggle('hidden', !inp.value);
    renderResultadosMapa();
  });
  inp.addEventListener('focus', () => { if (inp.value.trim()) renderResultadosMapa(); });
  inp.addEventListener('keydown', (e) => {
    const n = BuscadorMapa.resultados.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); marcarResultadoActivo((BuscadorMapa.activo + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); marcarResultadoActivo((BuscadorMapa.activo - 1 + n) % n); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!ul.classList.contains('hidden') && n) seleccionarResultadoMapa(BuscadorMapa.activo >= 0 ? BuscadorMapa.activo : 0);
    } else if (e.key === 'Escape') {
      if (ul.classList.contains('hidden')) { inp.value = ''; btn?.classList.add('hidden'); }
      cerrarResultadosMapa();
    }
  });
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) seleccionarResultadoMapa(Number(li.dataset.i));
  });
  btn?.addEventListener('click', () => { inp.value = ''; btn.classList.add('hidden'); cerrarResultadosMapa(); inp.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.mapa-buscador')) cerrarResultadosMapa(); });
}

// ——— Geolocalización del usuario ———
// Se pide UNA vez por visita, la primera vez que el usuario entra a la pantalla
// Mapa (no apenas abre la página). La ubicación se usa SOLO en el navegador
// para dibujar el punto azul: no se guarda ni se envía a ningún servidor.
function pedirUbicacionUnaVez() {
  if (Store.geoPedida) return;
  Store.geoPedida = true;
  geolocalizarUsuario();
}

function setGeoEstado(msg, tipo = '') {
  const el = document.getElementById('geoEstado');
  if (!el) return;
  el.textContent = msg;
  el.className = 'geo-estado' + (tipo ? ' ' + tipo : '');
}

function distanciaKm(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function dibujarUsuarioEnMapa(lat, lng, precision) {
  if (!Store.mapa || typeof L === 'undefined') return;
  if (Store.marcadorUsuario) Store.mapa.removeLayer(Store.marcadorUsuario);
  if (Store.circuloUsuario) Store.mapa.removeLayer(Store.circuloUsuario);
  Store.circuloUsuario = null;
  if (precision && precision <= 1500) {
    Store.circuloUsuario = L.circle([lat, lng], {
      radius: precision, color: '#2B6CB0', weight: 1, fillColor: '#2B6CB0', fillOpacity: 0.12, interactive: false,
    }).addTo(Store.mapa);
  }
  Store.marcadorUsuario = L.marker([lat, lng], {
    icon: L.divIcon({ className: '', html: '<div class="mapa-usuario"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 1000, // interactive:false => se puede marcar una propuesta "a través" del punto
  }).addTo(Store.mapa);
}

function geolocalizarUsuario({ centrar = false } = {}) {
  const btn = document.getElementById('btnMiUbicacion');
  if (!('geolocation' in navigator)) {
    setGeoEstado('Tu navegador no permite geolocalización.', 'error');
    return;
  }
  if (!window.isSecureContext) {
    setGeoEstado('La geolocalización solo funciona con HTTPS (o en localhost).', 'error');
    return;
  }
  if (Store.buscandoUbicacion) return;
  Store.buscandoUbicacion = true;
  btn?.classList.add('buscando');
  setGeoEstado('Buscando tu ubicación…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      Store.buscandoUbicacion = false;
      btn?.classList.remove('buscando');
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      Store.ubicacion = { lat, lng, precision: accuracy };
      dibujarUsuarioEnMapa(lat, lng, accuracy);
      const km = distanciaKm(lat, lng, CENTRO_SAN_TELMO[0], CENTRO_SAN_TELMO[1]);
      let msg = `Tu ubicación aparece en el mapa como un punto azul (precisión aprox. ${Math.round(accuracy)} m).`;
      if (km > 5) msg += ` Estás a unos ${Math.round(km)} km de San Telmo.`;
      setGeoEstado(msg, 'ok');
      if (centrar && Store.mapa) {
        Store.mapa.invalidateSize();
        Store.mapa.flyTo([lat, lng], 17, { duration: 0.8 });
      }
    },
    (err) => {
      Store.buscandoUbicacion = false;
      btn?.classList.remove('buscando');
      const msgs = {
        1: 'No pudimos acceder a tu ubicación porque el permiso está bloqueado. Habilitalo desde el candado de la barra de direcciones y tocá «Mi ubicación».',
        2: 'No pudimos determinar tu ubicación en este momento. Probá de nuevo con «Mi ubicación».',
        3: 'Se agotó el tiempo buscando tu ubicación. Probá de nuevo con «Mi ubicación».',
      };
      setGeoEstado(msgs[err.code] || 'No pudimos obtener tu ubicación.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function animarBarrasAlEntrar() {
  const seccionStats = document.getElementById('estadisticas');
  if (!seccionStats) return;
  const observer = new IntersectionObserver((entradas) => {
    if (entradas.some((e) => e.isIntersecting)) {
      document.querySelectorAll('.barra-fill').forEach((barra) => {
        barra.style.width = barra.getAttribute('data-ancho');
      });
      observer.disconnect();
    }
  }, { threshold: 0.3 });
  observer.observe(seccionStats);
}

// ——— Navegación por vistas + menú hamburguesa ———
// Cada sección es una "pantalla" (clase .vista). Se navega con el hash de la
// URL (#mapa, #propuestas...), así funcionan los links, el botón "atrás" y
// se puede compartir el link directo a una sección.
const VISTAS = ['inicio', 'mapa', 'estadisticas', 'propuestas', 'asistente', 'integrantes'];

function aplicarVista(id) {
  if (!VISTAS.includes(id)) id = 'inicio';
  document.querySelectorAll('main .vista').forEach((v) => v.classList.toggle('activa', v.id === id));
  document.querySelectorAll('#menuLateral [data-vista]').forEach((a) => {
    const activo = a.dataset.vista === id;
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  cerrarMenu();
  // Leaflet calcula mal su tamaño si el mapa estaba oculto al crearse
  if (id === 'mapa' && Store.mapa) setTimeout(() => Store.mapa.invalidateSize(), 60);
  if (id === 'mapa') pedirUbicacionUnaVez(); // recién acá se pide el permiso
}

function mostrarVista(id) {
  if (location.hash === '#' + id) aplicarVista(id);
  else location.hash = id; // dispara "hashchange" -> aplicarVista
}

function abrirMenu() {
  document.getElementById('menuLateral')?.classList.add('abierto');
  document.getElementById('drawerBackdrop')?.classList.add('abierto');
  const btn = document.getElementById('btnHamburguesa');
  btn?.setAttribute('aria-expanded', 'true');
  btn?.setAttribute('aria-label', 'Cerrar menú');
}

function cerrarMenu() {
  document.getElementById('menuLateral')?.classList.remove('abierto');
  document.getElementById('drawerBackdrop')?.classList.remove('abierto');
  const btn = document.getElementById('btnHamburguesa');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.setAttribute('aria-label', 'Abrir menú');
}

function activarNavegacion() {
  const btn = document.getElementById('btnHamburguesa');
  btn?.addEventListener('click', () => {
    btn.getAttribute('aria-expanded') === 'true' ? cerrarMenu() : abrirMenu();
  });
  document.getElementById('drawerBackdrop')?.addEventListener('click', cerrarMenu);
  document.getElementById('menuLateral')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) cerrarMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });
  window.addEventListener('hashchange', () => aplicarVista(location.hash.slice(1)));
  aplicarVista(location.hash.slice(1));
}

// ——— Integrantes del grupo ———
// EDITÁ ESTA LISTA: una línea por integrante. "foto" es opcional
// (ej: 'fotos/juan.jpg'); si la dejás vacía se muestran las iniciales.
const INTEGRANTES = [
  { nombre: 'Gil Mendive Ramiro', rol: 'Optimizacion de la pagina / 4°2 computacion' },
  { nombre: 'Laxi Maximo Segundo', rol: 'Optimizacion de la pagina / 4°2 computacion' },
  { nombre: 'Mammani Maylen', rol: 'Creacion de videos y resumen de la pagina / 4°2 computacion', foto: '' },
  { nombre: 'Madai Mariela Andacaba', rol: 'desarrolladora original de la pagina y participante antigua en aerohack / 6°2 computacion', foto: '' },
  { nombre: 'Antonella Vivacqua', rol: ' desarrolladora original de la pagina y participante antigua en aerohack/ 6°2 computacion', foto: '' },
  { nombre: 'Villa Godoy Thiago', rol: 'Optimizacion de la pagina / 4°2 computacion', foto: '' },
];

function renderIntegrantes() {
  const grid = document.getElementById('integrantesGrid');
  if (!grid) return;
  grid.textContent = '';
  INTEGRANTES.forEach((i) => {
    const card = document.createElement('div');
    card.className = 'integrante-card';

    const avatar = document.createElement('div');
    avatar.className = 'integrante-avatar';
    if (i.foto) {
      const img = document.createElement('img');
      img.src = i.foto;
      img.alt = i.nombre;
      img.onerror = () => { avatar.textContent = iniciales(i.nombre); };
      avatar.appendChild(img);
    } else {
      avatar.textContent = iniciales(i.nombre);
    }

    const nombre = document.createElement('div');
    nombre.className = 'integrante-nombre';
    nombre.textContent = i.nombre;
    const rol = document.createElement('div');
    rol.className = 'integrante-rol';
    rol.textContent = i.rol;

    card.append(avatar, nombre, rol);
    grid.appendChild(card);
  });
}

function iniciales(nombre) {
  return String(nombre).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
}

// El prompt del asistente ahora vive en server.js (junto con la API key),
// no en el navegador. Ver SYSTEM_PROMPT en server.js si lo querés editar.

function addMsg(texto, rol) {
  const box = document.getElementById('aiMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `msg msg-${rol}`;
  div.textContent = texto;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addTyping() {
  const box = document.getElementById('aiMessages');
  if (!box) return null;
  const div = document.createElement('div');
  div.className = 'msg msg-typing';
  div.id = 'typingIndicator';
  div.innerHTML = 'Escribiendo <div class="typing-dots"><span></span><span></span><span></span></div>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function enviarMensaje() {
  const aiInput = document.getElementById('aiInput');
  const aiSendBtn = document.getElementById('aiSendBtn');
  const texto = (aiInput?.value || '').trim();
  if (!texto || aiSendBtn?.disabled) return;
  addMsg(texto, 'user');
  if (aiInput) aiInput.value = '';
  if (aiSendBtn) aiSendBtn.disabled = true;
  const typing = addTyping();
  try {
    // Llamamos a NUESTRO backend (/api/ai/chat), no directo a Google:
    // la API key vive en el servidor (.env) y nunca se expone en el navegador.
    const response = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: texto }),
    });
    const data = await response.json();
    typing?.remove();
    if (!response.ok) {
      addMsg(data.error || 'Lo siento, no pude procesar tu consulta. Intentá de nuevo.', 'bot');
    } else {
      addMsg(data.texto || 'Lo siento, no pude procesar tu consulta. Intentá de nuevo.', 'bot');
    }
  } catch {
    typing?.remove();
    addMsg('Hubo un error al conectar. Por favor intentá de nuevo en un momento.', 'bot');
  }
  if (aiSendBtn) aiSendBtn.disabled = false;
  aiInput?.focus();
}

function preguntarSugerencia(chip) {
  const aiInput = document.getElementById('aiInput');
  if (aiInput) aiInput.value = chip.textContent;
  enviarMensaje();
}

async function intentarCargarDesdeAPI() {
  try {
    const res = await fetch(`${API_BASE}/api/propuestas`);
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    Store.propuestas = data.map(normalizePropuesta);
    persistPropuestas();
  } catch (_) {}
}

// Reemplaza (en el mismo array) las fichas fijas por las guardadas en la base.
async function cargarZonasDesdeAPI() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${API_BASE}/api/zonas`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return; // (una lista vacía es válida: el moderador pudo borrar todo)
    const norm = (z) => ({
      id: String(z.id), lat: Number(z.latitud), lng: Number(z.longitud),
      simbolo: z.simbolo || '', titulo: z.titulo, resumen: z.resumen || '', detalle: z.detalle || '',
      likes: Number(z.likes) || 0,
    });
    const validas = (z) => Number.isFinite(z.lat) && Number.isFinite(z.lng);
    const verdes = data.filter((z) => z.tipo === 'verde').map(norm).filter(validas);
    const calor = data.filter((z) => z.tipo === 'calor').map(norm).filter(validas);
    ESPACIOS_VERDES.splice(0, ESPACIOS_VERDES.length, ...verdes);
    ISLAS_CALOR.splice(0, ISLAS_CALOR.length, ...calor);
  } catch (_) { /* sin API: quedan los datos de respaldo */ }
}

async function init() {
  activarNavegacion(); // primero el menú, así anda aunque falle el mapa
  renderIntegrantes();
  activarBuscador();
  activarBuscadorMapa();
  hydrateStore();
  await cargarZonasDesdeAPI(); // fichas desde la base de datos (antes de dibujar los marcadores)
  inicializarMapa();
  sincronizarLikesZonasConServidor();
  if (Store.ubicacion) dibujarUsuarioEnMapa(Store.ubicacion.lat, Store.ubicacion.lng, Store.ubicacion.precision);
  animarBarrasAlEntrar();
  document.getElementById('modalLogin')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalLogin') cerrarModalLogin();
  });
  document.getElementById('modalTotal')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalTotal') cerrarModalTotal();
    if (e.target.id === 'modalDetalle') cerrarModalDetalle();
  });
  document.getElementById('modalModeracion')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalModeracion') cerrarModalModeracion();
  });
  document.getElementById('modalBanDuracion')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalBanDuracion') cerrarModalBan();
  });
  document.getElementById('aiInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enviarMensaje();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pcard-menu-wrap')) cerrarMenusPropuesta();
  });
  await intentarCargarDesdeAPI();
  renderAuthUI();
  renderAll();
  await refrescarEstadoBan();
  // Re-chequear ban cada minuto por si expira mientras está en la página
  setInterval(() => {
    if (Store.usuario?.baneado_hasta) actualizarBannerBan();
  }, 60000);
  // Google puede cargar async; reintentar init del botón
  window.addEventListener('load', () => setTimeout(inicializarGoogleButton, 300));
  setTimeout(inicializarGoogleButton, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}



// ____ Codigo SECRETO KONAMI ______
let SANTELMOURL = 'https://www.youtube.com/watch?v=q7dfO4XJMoM';

function iniciarKonami() {
  const codigoKonami = [
    'ArrowUp', 'ArrowUp',
    'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight',
    'ArrowLeft', 'ArrowRight',
    'b', 'a'
  ];

  let indiceKonami = 0;
  let activo = true;

  // Temporizador: Desactiva la escucha a los 10 segundos
  const temporizador = setTimeout(() => {
    activo = false;
    window.removeEventListener('keydown', manejarKonami);
  }, 10000); // 10000 ms = 10 segundos

  function manejarKonami(event) {
    if (!activo) return;

    // 'b'/'a' comparan sin importar mayúsculas; 'ArrowUp' etc. se comparan
    // TAL CUAL las entrega el navegador (nunca en minúsculas: "arrowup" no
    // es igual a "ArrowUp"). Antes se bajaba a minúsculas SOLO lo esperado
    // y no lo presionado para las flechas, por eso nunca coincidían.
    const coincideCon = (tecla) =>
      tecla.length === 1 ? event.key.toLowerCase() === tecla.toLowerCase() : event.key === tecla;

    if (coincideCon(codigoKonami[indiceKonami])) {
      indiceKonami++;
      if (indiceKonami === codigoKonami.length) {
        clearTimeout(temporizador); // Cancela el reloj si lo activó a tiempo
        activarSecreto();
        indiceKonami = 0;
      }
    } else {
      indiceKonami = coincideCon(codigoKonami[0]) ? 1 : 0;
    }
  }

  // Escucha el teclado asignando la función con nombre para poder removerla después
  window.addEventListener('keydown', manejarKonami);

  function activarSecreto() {
    window.location.href = SANTELMOURL;
  }
}

// script.js se carga al final del <body>, así que cuando este código corre,
// el DOMContentLoaded casi siempre YA DISPARÓ — por eso el
// addEventListener('DOMContentLoaded', ...) de antes nunca se ejecutaba
// (el evento ya había pasado). Mismo patrón de arreglo que usa init() más arriba.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciarKonami);
} else {
  iniciarKonami();
}
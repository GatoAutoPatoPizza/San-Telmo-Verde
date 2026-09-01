/* ============================================
   SAN TELMO VERDE — LÓGICA (JS)
   Estado centralizado + votación unificada
============================================ */

const CENTRO_SAN_TELMO = [-34.6212, -58.3714];
const API_BASE = 'http://localhost:3000';

/* ── PEGÁ ACÁ tu Client ID de Google Cloud Console ──
   Debe coincidir con data-client_id en index.html
   Ejemplo: '123456789-abc.apps.googleusercontent.com' */
const GOOGLE_CLIENT_ID = 'PEGAR_AQUI_TU_CLIENT_ID.apps.googleusercontent.com';

/* Emails autorizados a moderar (coinciden con el email de Google al ingresar).
   Agregá los del equipo. También podés usar el flag local stv_soy_mod=1 en consola. */
const MODERADORES = [
  'tu-email@gmail.com',
  // 'otro.moderador@gmail.com',
];

const KEYS = {
  propuestas: 'stv_propuestas',
  usuario: 'stv_usuario',
  votos: 'stv_votos',
  denuncias: 'stv_denuncias', // { [userId]: { [propuestaId]: true } }
};

const Store = {
  propuestas: [],
  usuario: null,
  votosUsuario: new Set(),
  marcadores: {},
  marcadorTemporal: null,
  modoUbicacion: false,
  mapa: null,
  capas: { verde: null, calor: null, prop: null },
  filtros: { verde: true, calor: true, prop: true },
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
        </div>
      </div>`
    )
    .join('');
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

function renderModPropuestas(propuestas) {
  const cont = document.getElementById('modPropuestasList');
  if (!cont) return;
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
      return `
      <div class="mod-card">
        <h4>${escapeHtml(p.titulo)} ${badge}</h4>
        <p>${escapeHtml(p.descripcion || '')}</p>
        <div class="mod-meta">${escapeHtml(p.direccion || '')} · ${escapeHtml(p.nombre_usuario || 'Anonimo')} · ${p.votos || 0} votos</div>
        <div class="mod-actions">${accion}</div>
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
  propuestaById: (id) => Store.propuestas.find((p) => String(p.id) === String(id)) || null,
  propuestasActivas: () => Store.propuestas.filter((p) => (p.estado || '') !== 'Archivada'),
  topPropuestas: (n = 3) =>
    [...select.propuestasActivas()].sort((a, b) => (b.votos || 0) - (a.votos || 0)).slice(0, n),
};

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
  renderAuthUI();
  renderAll();
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
  L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(Store.mapa);

  Store.capas.verde = L.layerGroup().addTo(Store.mapa);
  Store.capas.calor = L.layerGroup().addTo(Store.mapa);
  Store.capas.prop = L.layerGroup().addTo(Store.mapa);

  [
    { lat: -34.6289, lng: -58.3697, popup: '<strong>Parque Lezama</strong><br>7.2 ha · El más grande del barrio', simbolo: 'P' },
    { lat: -34.6212, lng: -58.3731, popup: '<strong>Plazoleta Dorrego</strong><br>0.3 ha · Centro histórico' },
    { lat: -34.6175, lng: -58.3720, popup: 'Pequeña plaza · Calle Humberto' },
  ].forEach((p) => {
    L.marker([p.lat, p.lng], { icon: crearIcono('verde', p.simbolo || '') })
      .bindPopup(p.popup)
      .addTo(Store.capas.verde);
  });

  [
    { lat: -34.6165, lng: -58.3775, popup: 'Isla de calor · Zona norte · +3.2°C' },
    { lat: -34.6245, lng: -58.3715, popup: 'Isla de calor · Zona central · +2.8°C' },
    { lat: -34.6195, lng: -58.3675, popup: 'Isla de calor · Zona este · +4.1°C' },
  ].forEach((p) => {
    L.marker([p.lat, p.lng], { icon: crearIcono('calor', '!') })
      .bindPopup(p.popup)
      .addTo(Store.capas.calor);
  });

  Store.mapa.on('click', onMapClick);
}

function onMapClick(e) {
  if (!Store.modoUbicacion || !Store.mapa) return;
  const { lat, lng } = e.latlng;
  document.getElementById('inputLat').value = lat.toFixed(6);
  document.getElementById('inputLng').value = lng.toFixed(6);
  const texto = document.getElementById('ubicacionTexto');
  if (texto) {
    texto.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    texto.classList.add('marcada');
  }
  clearMarcadorTemporal();
  Store.marcadorTemporal = L.marker([lat, lng], { icon: crearIcono('prop', '★') }).addTo(Store.mapa);
  cancelarModoUbicacion();
}

function activarModoUbicacion() {
  if (!select.isLoggedIn()) {
    abrirModalLogin();
    return;
  }
  Store.modoUbicacion = true;
  document.getElementById('modoUbicacionBanner')?.classList.remove('hidden');
  document.getElementById('map')?.classList.add('cursor-crosshair');
  document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarModoUbicacion() {
  Store.modoUbicacion = false;
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
    </div>
  `;
}

function renderListaPropuestas() {
  const lista = document.getElementById('propuestasList');
  const contador = document.getElementById('contadorProp');
  const statP = document.getElementById('statPropuestas');
  const activas = select.propuestasActivas();
  if (contador) contador.textContent = String(activas.length);
  if (statP) statP.textContent = String(activas.length);
  if (!lista) return;
  if (activas.length === 0) {
    lista.innerHTML = `
      <div class="empty-propuestas" id="emptyPropuestas">
        <p>Todavía no hay propuestas. Sé el primero en proponer un espacio verde en el barrio.</p>
      </div>`;
    return;
  }
  const ordenadas = [...activas].sort((a, b) => (b.votos || 0) - (a.votos || 0));
  lista.innerHTML = ordenadas.map(tarjetaPropuestaHTML).join('');
}

function renderPanelLateral() {
  const panel = document.getElementById('mapaPanel');
  if (!panel) return;
  let html = `
    <div class="panel-card">
      <h4>🌳 Parque Lezama</h4>
      <p>El espacio verde más grande de San Telmo con 7.2 hectáreas.</p>
      <span class="tag">ACTIVO · 7.2 ha</span>
    </div>
    <div class="panel-card">
      <h4>🌳 Plazoleta Dorrego</h4>
      <p>Plaza histórica del centro de San Telmo · 0.3 ha.</p>
      <span class="tag">ACTIVO · Histórico</span>
    </div>
  `;
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

function abrirModalTotal() {
  const modal = document.getElementById('modalTotal');
  const content = document.getElementById('modalBodyContent');
  if (!modal || !content) return;
  let html = '<div class="modal-section-title">Fichas del mapa</div>';
  html += `
    <div class="panel-card" style="margin-bottom:0.5rem"><h4>🌳 Parque Lezama</h4><p>7.2 ha · Espacio verde principal</p><span class="tag">ACTIVO</span></div>
    <div class="panel-card" style="margin-bottom:0.5rem"><h4>🌳 Plazoleta Dorrego</h4><p>0.3 ha · Centro histórico</p><span class="tag">ACTIVO</span></div>
  `;
  html += '<div class="modal-section-title" style="margin-top:1.5rem">Propuestas ciudadanas</div>';
  const activas = select.propuestasActivas();
  if (activas.length === 0) {
    html += '<p style="font-size:0.85rem;color:var(--pizarra-claro)">No hay propuestas registradas todavía.</p>';
  } else {
    activas.forEach((p) => {
      html += `<div style="margin-bottom:0.5rem">${tarjetaPropuestaHTML(p)}</div>`;
    });
  }
  content.innerHTML = html;
  modal.classList.add('active');
}

function cerrarModalTotal() {
  document.getElementById('modalTotal')?.classList.remove('active');
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

function activarScrollSuave() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const destino = document.querySelector(link.getAttribute('href'));
      if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

const SYSTEM_PROMPT = `Sos el asistente de la plataforma San Telmo Verde, una iniciativa ciudadana de Buenos Aires para recuperar espacios verdes urbanos en el barrio de San Telmo.

Tu rol es ayudar a vecinos y vecinas con:
- Información sobre el proceso para proponer plazas de bolsillo, techos verdes y jardines comunitarios
- Datos sobre espacios verdes en San Telmo y Buenos Aires
- Normativas urbanísticas relevantes (mencionar que para detalles legales deben consultar la Legislatura o el GCBA)
- Plantas nativas de Buenos Aires recomendadas para espacios urbanos
- Cómo reducir el efecto isla de calor
- El ODS 11 y ciudades sostenibles

Respondé de forma cálida, cercana y concreta. Usá frases cortas. Podés usar algún emoji ocasionalmente. Siempre alentá la participación ciudadana. Respondé siempre en español rioplatense.`;

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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: texto }],
      }),
    });
    const data = await response.json();
    typing?.remove();
    addMsg(data.content?.[0]?.text || 'Lo siento, no pude procesar tu consulta. Intentá de nuevo.', 'bot');
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

async function init() {
  hydrateStore();
  inicializarMapa();
  animarBarrasAlEntrar();
  activarScrollSuave();
  document.getElementById('modalLogin')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalLogin') cerrarModalLogin();
  });
  document.getElementById('modalTotal')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalTotal') cerrarModalTotal();
  });
  document.getElementById('modalModeracion')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalModeracion') cerrarModalModeracion();
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
  // Google puede cargar async; reintentar init del botón
  window.addEventListener('load', () => setTimeout(inicializarGoogleButton, 300));
  setTimeout(inicializarGoogleButton, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
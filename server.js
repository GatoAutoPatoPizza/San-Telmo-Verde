require('dotenv').config();

const express = require('express');
// mysql2 (no el paquete viejo "mysql") — soporta el protocolo de
// autenticación "caching_sha2_password" que usa MySQL 8 por defecto en
// Railway. El paquete "mysql" viejo no lo entiende y tira
// ER_NOT_SUPPORTED_AUTH_MODE. La API es la misma (createPool, query con
// callback), así que no hace falta cambiar nada más del archivo.
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
// Necesario detrás de un proxy/túnel (Codespaces, Render, Railway, etc.)
// para que Express detecte bien https y la IP real del cliente.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Servir el front desde la misma carpeta. Como el front usa rutas
// relativas ("/api/..."), esto funciona sirviendo en localhost:3000
// o detrás de cualquier dominio público (Codespaces, VPS, etc.).
app.use(express.static(__dirname));

const db = mysql.createPool({
  // Railway puede inyectar las variables del plugin de MySQL con distintos
  // nombres según cómo las hayas referenciado. Probamos ambas convenciones
  // para no depender de que coincida el nombre exacto.
  host: process.env.MYSQLHOST || process.env.DB_HOST || '127.0.0.1',
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
});

// Verificar la conexión del pool
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error al conectar a MySQL/MariaDB:', err.message);
  } else {
    console.log('¡Conectado exitosamente a la base de datos en Railway!');
    connection.release(); // Liberar la conexión al pool
  }
});

function dbQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
  });
}

/**
 * Decodifica payload del JWT sin verificar firma (fallback).
 * En producción se usa google-auth-library debajo.
 */
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  // Intentar verificación oficial si está instalada la lib y hay Client ID
  if (clientId && !clientId.startsWith('PEGAR')) {
    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      return ticket.getPayload();
    } catch (e) {
      console.warn('verifyIdToken falló, se usa decode local:', e.message);
    }
  }
  return decodeJwtPayload(credential);
}

// Login / registro con Google (cuenta real)
app.post('/api/auth/google', async (req, res) => {
  const { credential, google_id, email, nombre } = req.body || {};

  let payload = null;
  if (credential) {
    payload = await verifyGoogleCredential(credential);
  }

  const gid = (payload && payload.sub) || google_id;
  const mail = (payload && payload.email) || email;
  const name = (payload && (payload.name || payload.given_name)) || nombre || 'Usuario Google';

  if (!gid || !mail) {
    return res.status(400).json({ error: 'Credencial de Google inválida' });
  }

  try {
    let existing;
    try {
      existing = await dbQuery(
        'SELECT id, nombre, email, google_id, baneado_hasta FROM usuarios WHERE google_id = ? OR email = ? LIMIT 1',
        [gid, mail]
      );
    } catch (_) {
      existing = await dbQuery(
        'SELECT id, nombre, email, google_id FROM usuarios WHERE google_id = ? OR email = ? LIMIT 1',
        [gid, mail]
      );
    }

    if (existing.length) {
      const u = existing[0];
      // Actualizar google_id si faltaba
      if (!u.google_id) {
        await dbQuery('UPDATE usuarios SET google_id = ?, nombre = ? WHERE id = ?', [gid, name, u.id]);
      }
      const banHasta = u.baneado_hasta ? new Date(u.baneado_hasta) : null;
      const banActivo = banHasta && banHasta.getTime() > Date.now();
      return res.json({
        id: u.id,
        nombre: name || u.nombre,
        email: u.email || mail,
        google_id: gid,
        baneado_hasta: banActivo ? banHasta.toISOString() : null,
      });
    }

    const ins = await dbQuery(
      'INSERT INTO usuarios (nombre, email, google_id) VALUES (?, ?, ?)',
      [name, mail, gid]
    );
    res.status(201).json({
      id: ins.insertId,
      nombre: name,
      email: mail,
      google_id: gid,
      baneado_hasta: null,
    });
  } catch (e) {
    // Si MySQL no está, devolvemos el perfil para que el front siga
    if (e.code === 'ECONNREFUSED' || String(e.message).includes('not available')) {
      return res.json({ id: gid, nombre: name, email: mail, google_id: gid, baneado_hasta: null });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Zonas del mapa (espacios verdes e islas de calor) ──
// La tabla se crea sola y se carga con los datos iniciales si está vacía,
// así no hace falta importar nada a mano en Railway.
const ZONAS_INICIALES = [
  ["verde-lezama", "verde", "Parque Lezama", "7.2 ha · El más grande del barrio", "El espacio verde más grande de San Telmo, con 7.2 hectáreas. Zona histórica con anfiteatro, el Museo Histórico Nacional y una gran variedad de árboles añosos.", "-34.6289", "-58.3697", "P"],
  ["verde-dorrego", "verde", "Plazoleta Dorrego", "0.3 ha · Centro histórico", "Plaza chica en pleno centro histórico de San Telmo, rodeada de anticuarios. Sede de la feria de los domingos.", "-34.6212", "-58.3731", ""],
  ["verde-humberto", "verde", "Plazoleta Calle Humberto", "Pequeña plaza de barrio", "Espacio verde chico sobre la calle Humberto Primo, de uso vecinal cotidiano.", "-34.6175", "-58.3720", ""],
  ["calor-norte", "calor", "Isla de calor · Zona norte", "+3.2°C", "Zona con muy poca cobertura verde y alta densidad de construcción, lo que eleva la temperatura superficial respecto al resto del barrio.", "-34.6165", "-58.3775", ""],
  ["calor-centro", "calor", "Isla de calor · Zona central", "+2.8°C", "Concentración de superficies de asfalto y hormigón sin arbolado que retienen calor durante el día y lo liberan de noche.", "-34.6245", "-58.3715", ""],
  ["calor-este", "calor", "Isla de calor · Zona este", "+4.1°C", "La zona con mayor diferencia de temperatura registrada del barrio, cerca de la avenida Paseo Colón, con escasa vegetación.", "-34.6195", "-58.3675", ""],
]; // [id, tipo, titulo, resumen, detalle, latitud, longitud, simbolo]

let tablaZonasPromesa = null;
function asegurarTablaZonas() {
  if (!tablaZonasPromesa) {
    tablaZonasPromesa = (async () => {
      await dbQuery(`CREATE TABLE IF NOT EXISTS zonas_mapa (
        id VARCHAR(50) NOT NULL PRIMARY KEY,
        tipo ENUM('verde','calor') NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        resumen VARCHAR(255) NOT NULL DEFAULT '',
        detalle TEXT NOT NULL,
        latitud DECIMAL(10,7) NOT NULL,
        longitud DECIMAL(10,7) NOT NULL,
        simbolo VARCHAR(5) NOT NULL DEFAULT '',
        activo TINYINT(1) NOT NULL DEFAULT 1,
        orden INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const [{ n }] = await dbQuery('SELECT COUNT(*) AS n FROM zonas_mapa');
      if (Number(n) === 0) {
        for (let i = 0; i < ZONAS_INICIALES.length; i += 1) {
          await dbQuery(
            'INSERT INTO zonas_mapa (id, tipo, titulo, resumen, detalle, latitud, longitud, simbolo, orden) VALUES (?,?,?,?,?,?,?,?,?)',
            [...ZONAS_INICIALES[i], i]
          );
        }
        console.log('zonas_mapa: se cargaron las fichas iniciales');
      }
    })().catch((e) => {
      tablaZonasPromesa = null;
      throw e;
    });
  }
  return tablaZonasPromesa;
}
asegurarTablaZonas().catch((e) => console.warn('Zonas: no se pudo preparar la tabla zonas_mapa:', e.message));

app.get('/api/zonas', async (req, res) => {
  try {
    await asegurarTablaZonas();
    const rows = await dbQuery('SELECT id, tipo, titulo, resumen, detalle, latitud, longitud, simbolo FROM zonas_mapa WHERE activo = 1 ORDER BY orden, created_at');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/propuestas', async (req, res) => {
  try {
    const rows = await dbQuery(
      "SELECT * FROM propuestas WHERE estado != 'Archivada' ORDER BY votos DESC, created_at DESC"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/propuestas-populares', async (req, res) => {
  try {
    const rows = await dbQuery(
      "SELECT * FROM propuestas WHERE estado != 'Archivada' ORDER BY votos DESC, created_at DESC LIMIT 3"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/propuestas', async (req, res) => {
  const { titulo, direccion, descripcion, tipo, latitud, longitud, usuario } = req.body;
  if (!titulo || !direccion) return res.status(400).json({ error: 'Título y dirección obligatorios' });

  try {
    let usuarioId = null;
    let nombreUsuario = 'Anonimo';

    if (usuario && (usuario.email || usuario.google_id)) {
      const existing = await dbQuery(
        'SELECT id, nombre, baneado_hasta FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1',
        [usuario.email || null, usuario.google_id || null]
      );
      if (existing.length) {
        usuarioId = existing[0].id;
        nombreUsuario = existing[0].nombre;
        // Timeout / ban: no permitir publicar si está restringido
        if (existing[0].baneado_hasta) {
          const hasta = new Date(existing[0].baneado_hasta);
          if (hasta.getTime() > Date.now()) {
            return res.status(403).json({
              error: 'Estás baneado temporalmente y no podés publicar propuestas.',
              baneado: true,
              baneado_hasta: hasta.toISOString(),
            });
          }
        }
      } else {
        const ins = await dbQuery('INSERT INTO usuarios (nombre, email, google_id) VALUES (?, ?, ?)', [
          usuario.nombre || 'Vecino/a',
          usuario.email || `${usuario.google_id}@google.local`,
          usuario.google_id || null,
        ]);
        usuarioId = ins.insertId;
        nombreUsuario = usuario.nombre || 'Vecino/a';
      }
    }

    const result = await dbQuery(
      `INSERT INTO propuestas
        (titulo, direccion, descripcion, tipo, votos, nombre_usuario, usuario_id, estado, latitud, longitud)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'Nueva', ?, ?)`,
      [titulo, direccion, descripcion || '', tipo || 'Plaza de bolsillo', nombreUsuario, usuarioId, latitud ?? null, longitud ?? null]
    );

    const propuestaId = result.insertId;
    if (usuarioId) {
      try {
        await dbQuery('INSERT INTO votos_propuesta (propuesta_id, usuario_id) VALUES (?, ?)', [
          propuestaId,
          usuarioId,
        ]);
      } catch (_) {}
    }

    const rows = await dbQuery('SELECT * FROM propuestas WHERE id = ?', [propuestaId]);
    res.status(201).json(rows[0] || { id: propuestaId, votos: 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/propuestas/:id/votar', async (req, res) => {
  const propuestaId = req.params.id;
  const { usuario_id, email, google_id } = req.body;

  try {
    let uid = usuario_id;
    if (!uid && (email || google_id)) {
      const u = await dbQuery('SELECT id FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1', [
        email || null,
        google_id || null,
      ]);
      if (u.length) uid = u[0].id;
    }
    // Si el id es el google_id (sesión sin MySQL numérico), buscar por google_id
    if (!uid && usuario_id) {
      const u2 = await dbQuery('SELECT id FROM usuarios WHERE google_id = ? LIMIT 1', [String(usuario_id)]);
      if (u2.length) uid = u2[0].id;
    }
    if (!uid) return res.status(401).json({ error: 'Usuario requerido' });

    await dbQuery('INSERT INTO votos_propuesta (propuesta_id, usuario_id) VALUES (?, ?)', [propuestaId, uid]);
    await dbQuery('UPDATE propuestas SET votos = votos + 1 WHERE id = ?', [propuestaId]);
    const rows = await dbQuery('SELECT * FROM propuestas WHERE id = ?', [propuestaId]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya votaste esta propuesta' });
    res.status(500).json({ error: e.message });
  }
});


// Desvotar
app.post('/api/propuestas/:id/desvotar', async (req, res) => {
  const propuestaId = req.params.id;
  const { usuario_id, email, google_id } = req.body || {};
  try {
    let uid = usuario_id;
    if (!uid && (email || google_id)) {
      const u = await dbQuery('SELECT id FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1', [
        email || null,
        google_id || null,
      ]);
      if (u.length) uid = u[0].id;
    }
    if (!uid && usuario_id) {
      const u2 = await dbQuery('SELECT id FROM usuarios WHERE google_id = ? LIMIT 1', [String(usuario_id)]);
      if (u2.length) uid = u2[0].id;
    }
    if (!uid) return res.status(401).json({ error: 'Usuario requerido' });

    const del = await dbQuery(
      'DELETE FROM votos_propuesta WHERE propuesta_id = ? AND usuario_id = ?',
      [propuestaId, uid]
    );
    if (del.affectedRows > 0) {
      await dbQuery(
        'UPDATE propuestas SET votos = GREATEST(0, votos - 1) WHERE id = ?',
        [propuestaId]
      );
    }
    const rows = await dbQuery('SELECT * FROM propuestas WHERE id = ?', [propuestaId]);
    res.json(rows[0] || { id: propuestaId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar propuesta (solo el autor)
app.delete('/api/propuestas/:id', async (req, res) => {
  const propuestaId = req.params.id;
  const { usuario_id, email, google_id } = req.body || {};
  try {
    let uid = usuario_id;
    if (!uid && (email || google_id)) {
      const u = await dbQuery('SELECT id FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1', [
        email || null,
        google_id || null,
      ]);
      if (u.length) uid = u[0].id;
    }
    if (!uid && usuario_id) {
      const u2 = await dbQuery('SELECT id FROM usuarios WHERE google_id = ? LIMIT 1', [String(usuario_id)]);
      if (u2.length) uid = u2[0].id;
    }
    if (!uid) return res.status(401).json({ error: 'Usuario requerido' });

    // Verificar autoría real contra la columna usuario_id de la propuesta.
    // Antes esto solo chequeaba que el usuario existiera (cualquier usuario
    // logueado podía borrar la propuesta de otro); ahora se exige que sea el autor.
    const propRows = await dbQuery('SELECT usuario_id FROM propuestas WHERE id = ?', [propuestaId]);
    if (!propRows.length) return res.status(404).json({ error: 'Propuesta no encontrada' });
    const dueño = propRows[0].usuario_id;
    if (dueño != null && String(dueño) !== String(uid)) {
      return res.status(403).json({ error: 'Solo podés eliminar tus propias propuestas' });
    }

    await dbQuery('DELETE FROM propuestas WHERE id = ?', [propuestaId]);
    res.json({ ok: true, id: propuestaId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Denunciar propuesta
app.post('/api/propuestas/:id/denunciar', async (req, res) => {
  const propuestaId = req.params.id;
  const { usuario_id, email, google_id, motivo } = req.body || {};
  try {
    let uid = usuario_id;
    if (!uid && (email || google_id)) {
      const u = await dbQuery('SELECT id FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1', [
        email || null,
        google_id || null,
      ]);
      if (u.length) uid = u[0].id;
    }
    if (!uid && usuario_id) {
      const u2 = await dbQuery('SELECT id FROM usuarios WHERE google_id = ? LIMIT 1', [String(usuario_id)]);
      if (u2.length) uid = u2[0].id;
    }
    if (!uid) return res.status(401).json({ error: 'Usuario requerido' });

    // Tabla denuncias (si no existe, el error se reporta)
    await dbQuery(
      `INSERT INTO denuncias (propuesta_id, usuario_id, motivo, estado)
       VALUES (?, ?, ?, 'pendiente')
       ON DUPLICATE KEY UPDATE motivo = VALUES(motivo)`,
      [propuestaId, uid, (motivo || 'Sin motivo').slice(0, 500)]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      // Crear tabla al vuelo y reintentar
      try {
        await dbQuery(`
          CREATE TABLE IF NOT EXISTS denuncias (
            id INT AUTO_INCREMENT PRIMARY KEY,
            propuesta_id INT NOT NULL,
            usuario_id INT NOT NULL,
            motivo VARCHAR(500) DEFAULT '',
            estado ENUM('pendiente','revisada','descartada') DEFAULT 'pendiente',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY denuncia_unica (propuesta_id, usuario_id),
            FOREIGN KEY (propuesta_id) REFERENCES propuestas(id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await dbQuery(
          `INSERT INTO denuncias (propuesta_id, usuario_id, motivo, estado)
           VALUES (?, ?, ?, 'pendiente')
           ON DUPLICATE KEY UPDATE motivo = VALUES(motivo)`,
          [propuestaId, uid, (motivo || 'Sin motivo').slice(0, 500)]
        );
        return res.status(201).json({ ok: true, created_table: true });
      } catch (e2) {
        return res.status(500).json({ error: e2.message });
      }
    }
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya denunciaste' });
    res.status(500).json({ error: e.message });
  }
});



// ——— Asistente IA (proxy a la API de Gemini de Google) ———
// La API key NUNCA va en script.js/index.html: vive acá, en el server,
// tomada de la variable de entorno GEMINI_API_KEY (ver .env.example).
// Conseguila gratis en https://aistudio.google.com/apikey
const SYSTEM_PROMPT = `Sos el asistente de la plataforma San Telmo Verde, una iniciativa ciudadana de Buenos Aires para recuperar espacios verdes urbanos en el barrio de San Telmo.

Tu rol es ayudar a vecinos y vecinas con:
- Información sobre el proceso para proponer plazas de bolsillo, techos verdes y jardines comunitarios
- Datos sobre espacios verdes en San Telmo y Buenos Aires
- Normativas urbanísticas relevantes (mencionar que para detalles legales deben consultar la Legislatura o el GCBA)
- Plantas nativas de Buenos Aires recomendadas para espacios urbanos
- Cómo reducir el efecto isla de calor
- El ODS 11 y ciudades sostenibles

Respondé de forma cálida, cercana y concreta. Usá frases cortas. Podés usar algún emoji ocasionalmente. Siempre alentá la participación ciudadana. Respondé siempre en español rioplatense.`;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
// Modelo de respaldo si el principal está saturado (error 503/429)
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Llama a Gemini; reintenta ante saturación y prueba el modelo de respaldo.
async function llamarGemini(apiKey, mensaje) {
  const modelos = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
  let ultimo = { ok: false, status: 0, data: {} };
  for (const modelo of modelos) {
    for (let intento = 0; intento < 3; intento++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: mensaje }] }],
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) return { ok: true, status: 200, data };
      ultimo = { ok: false, status: response.status, data };
      console.error(`Gemini ${modelo} intento ${intento + 1}:`, response.status, data.error?.message);
      // Solo reintentamos si es saturación/error temporal
      if (![429, 500, 503, 504].includes(response.status)) return ultimo;
      await esperar(700 * (intento + 1));
    }
  }
  return ultimo;
}

app.post('/api/ai/chat', async (req, res) => {
  const mensaje = (req.body && req.body.mensaje || '').toString().trim().slice(0, 2000);
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'El asistente no está configurado: falta GEMINI_API_KEY en el servidor.',
    });
  }

  try {
    const { ok, data } = await llamarGemini(apiKey, mensaje);
    if (!ok) {
      const motivo = data.error?.message || data.error?.status || 'motivo desconocido';
      return res.status(502).json({ error: `El asistente no pudo responder (${motivo}).` });
    }
    const texto = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    res.json({ texto: texto || 'No obtuve respuesta, probá reformular tu consulta.' });
  } catch (e) {
    console.error('Fallo llamando a Gemini:', e.message);
    res.status(500).json({ error: 'Hubo un error al conectar con el asistente.' });
  }
});

// ——— Moderación ———
const MODERADORES = (process.env.MODERADORES || 'tu-email@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function esModeradorEmail(email) {
  if (!email) return false;
  return MODERADORES.includes(String(email).toLowerCase().trim());
}

app.get('/api/mod/denuncias', async (req, res) => {
  const email = req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const rows = await dbQuery(
      `SELECT d.*, p.titulo, p.descripcion, p.estado AS propuesta_estado, u.nombre AS denunciante
       FROM denuncias d
       LEFT JOIN propuestas p ON p.id = d.propuesta_id
       LEFT JOIN usuarios u ON u.id = d.usuario_id
       WHERE d.estado = 'pendiente'
       ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mod/propuestas', async (req, res) => {
  const email = req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const rows = await dbQuery(
      `SELECT p.*, u.baneado_hasta AS usuario_baneado_hasta
       FROM propuestas p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/mod/denuncias/:id', async (req, res) => {
  const { email, estado, propuesta_id } = req.body || {};
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    // id puede ser numérico (MySQL) o den_xxx (local) — solo actualizamos numéricos
    if (/^\d+$/.test(String(req.params.id))) {
      await dbQuery('UPDATE denuncias SET estado = ? WHERE id = ?', [estado || 'revisada', req.params.id]);
    }
    if (estado === 'revisada' && propuesta_id && /^\d+$/.test(String(propuesta_id))) {
      await dbQuery("UPDATE propuestas SET estado = 'Archivada' WHERE id = ?", [propuesta_id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mod/propuestas/:id/archivar', async (req, res) => {
  const { email } = req.body || {};
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    await dbQuery("UPDATE propuestas SET estado = 'Archivada' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mod/propuestas/:id/restaurar', async (req, res) => {
  const { email } = req.body || {};
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    await dbQuery("UPDATE propuestas SET estado = 'Nueva' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar propuesta definitivamente (moderador — no hace falta ser el autor)
app.delete('/api/mod/propuestas/:id', async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    // ON DELETE CASCADE en la tabla se encarga de borrar sus votos y denuncias asociadas
    await dbQuery('DELETE FROM propuestas WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar una denuncia puntual (sin tocar la propuesta) — moderador, no hace falta ser el denunciante
app.delete('/api/mod/denuncias/:id', async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  try {
    if (/^\d+$/.test(String(req.params.id))) {
      await dbQuery('DELETE FROM denuncias WHERE id = ?', [req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ ok: true });
    res.status(500).json({ error: e.message });
  }
});

// Banear / timeout a un usuario (moderador) — minutos desde ahora
app.post('/api/mod/usuarios/:id/banear', async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });
  const minutos = Math.max(1, parseInt(req.body?.minutos, 10) || 60);
  const uid = req.params.id;
  if (!uid || !/^\d+$/.test(String(uid))) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }
  try {
    const hasta = new Date(Date.now() + minutos * 60 * 1000);
    const result = await dbQuery('UPDATE usuarios SET baneado_hasta = ? WHERE id = ?', [hasta, uid]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, baneado_hasta: hasta.toISOString(), minutos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Quitar el ban de un usuario (moderador) inmediatamente.
app.post('/api/mod/usuarios/:id/desbanear', async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email || req.headers['x-mod-email'];
  if (!esModeradorEmail(email)) return res.status(403).json({ error: 'No autorizado' });

  const uid = req.params.id;
  if (!uid || !/^\d+$/.test(String(uid))) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  try {
    const result = await dbQuery('UPDATE usuarios SET baneado_hasta = NULL WHERE id = ?', [uid]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, baneado_hasta: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Consultar si un usuario está baneado (cualquier cliente autenticado)
app.get('/api/usuarios/estado-ban', async (req, res) => {
  const { email, id, google_id } = req.query;
  if (!email && !id && !google_id) {
    return res.status(400).json({ error: 'Falta email, id o google_id' });
  }
  try {
    let rows = [];
    if (id && /^\d+$/.test(String(id))) {
      rows = await dbQuery('SELECT id, baneado_hasta FROM usuarios WHERE id = ? LIMIT 1', [id]);
    } else if (email || google_id) {
      rows = await dbQuery(
        'SELECT id, baneado_hasta FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1',
        [email || null, google_id || null]
      );
    }
    if (!rows.length) {
      return res.json({ baneado: false, baneado_hasta: null });
    }
    const hasta = rows[0].baneado_hasta ? new Date(rows[0].baneado_hasta) : null;
    const activo = hasta && hasta.getTime() > Date.now();
    res.json({
      baneado: !!activo,
      baneado_hasta: activo ? hasta.toISOString() : null,
    });
  } catch (e) {
    // Si la columna aún no existe o MySQL no está, no bloqueamos al usuario
    if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ECONNREFUSED') {
      return res.json({ baneado: false, baneado_hasta: null });
    }
    res.status(500).json({ error: e.message });
  }
});


/* ============================================
   TRIVIA VERDE — puntos y ranking
   Campo: usuarios.puntos_trivia = MEJOR puntaje del usuario en la trivia.
   La columna se crea sola al arrancar si todavía no existe, así que no
   hace falta correr ningún ALTER a mano en una base ya creada.
============================================ */
const TRIVIA_MAX_PUNTOS = 2400; // 10 preguntas x 240 (máximo posible por pregunta)
const TRIVIA_MAX_LISTA = 500;   // tope de la lista completa del ranking

let columnaTriviaPromesa = null;
function asegurarColumnaTrivia() {
  if (!columnaTriviaPromesa) {
    columnaTriviaPromesa = (async () => {
      const cols = await dbQuery("SHOW COLUMNS FROM usuarios LIKE 'puntos_trivia'");
      if (!cols.length) {
        await dbQuery('ALTER TABLE usuarios ADD COLUMN puntos_trivia INT NOT NULL DEFAULT 0');
        console.log('Se agregó la columna usuarios.puntos_trivia');
      }
      // tiempo_trivia = segundos totales tardados en la partida que logró el
      // mejor puntaje (puntos_trivia). Se actualiza junto con el puntaje,
      // nunca por separado, para que ambos valores siempre correspondan a
      // la misma partida.
      const colsTiempo = await dbQuery("SHOW COLUMNS FROM usuarios LIKE 'tiempo_trivia'");
      if (!colsTiempo.length) {
        await dbQuery('ALTER TABLE usuarios ADD COLUMN tiempo_trivia INT NOT NULL DEFAULT 0');
        console.log('Se agregó la columna usuarios.tiempo_trivia');
      }
    })().catch((e) => {
      columnaTriviaPromesa = null; // reintentar en el próximo pedido
      throw e;
    });
  }
  return columnaTriviaPromesa;
}
asegurarColumnaTrivia().catch((e) => console.warn('Trivia: no se pudo verificar la columna puntos_trivia:', e.message));

/** Columna baneado_hasta para timeouts de moderación (se crea sola si falta). */
let columnaBanPromesa = null;
async function asegurarColumnaBan() {
  if (!columnaBanPromesa) {
    columnaBanPromesa = (async () => {
      const cols = await dbQuery("SHOW COLUMNS FROM usuarios LIKE 'baneado_hasta'");
      if (!cols.length) {
        await dbQuery('ALTER TABLE usuarios ADD COLUMN baneado_hasta DATETIME NULL DEFAULT NULL');
        console.log('Se agregó la columna usuarios.baneado_hasta');
      }
    })().catch((e) => {
      columnaBanPromesa = null;
      throw e;
    });
  }
  return columnaBanPromesa;
}
asegurarColumnaBan().catch((e) => console.warn('Ban: no se pudo verificar la columna baneado_hasta:', e.message));

/** Igual que en votar/denunciar: identifica al usuario por id, email o google_id. */
async function resolverUsuarioId(datos) {
  const { usuario_id, email, google_id } = datos || {};
  if (email || google_id) {
    const u = await dbQuery('SELECT id FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1', [
      email || null,
      google_id || null,
    ]);
    if (u.length) return u[0].id;
  }
  if (usuario_id) {
    const idTxt = String(usuario_id);
    const porId = /^\d{1,9}$/.test(idTxt);
    const u = porId
      ? await dbQuery('SELECT id FROM usuarios WHERE id = ? OR google_id = ? LIMIT 1', [Number(idTxt), idTxt])
      : await dbQuery('SELECT id FROM usuarios WHERE google_id = ? LIMIT 1', [idTxt]);
    if (u.length) return u[0].id;
  }
  return null;
}

/** Puesto de un puntaje: 1 + cantidad de jugadores con MÁS puntos (los empates comparten puesto). */
async function puestoDe(puntos) {
  const r = await dbQuery('SELECT COUNT(*) + 1 AS posicion FROM usuarios WHERE puntos_trivia > ?', [puntos]);
  const t = await dbQuery('SELECT COUNT(*) AS n FROM usuarios WHERE puntos_trivia > 0');
  return { posicion: Number(r[0].posicion), total: Number(t[0].n) };
}

function errorTrivia(res, e) {
  if (e.code === 'ECONNREFUSED' || String(e.message).includes('not available')) {
    return res.status(503).json({ error: 'Base de datos no disponible' });
  }
  return res.status(500).json({ error: e.message });
}

// Ranking: top N (limite=5 por defecto) o lista completa (limite=todos)
app.get('/api/trivia/ranking', async (req, res) => {
  try {
    await asegurarColumnaTrivia();
    const limite =
      req.query.limite === 'todos'
        ? TRIVIA_MAX_LISTA
        : Math.min(Math.max(parseInt(req.query.limite, 10) || 5, 1), TRIVIA_MAX_LISTA);
    const uid = await resolverUsuarioId(req.query);

    const filas = await dbQuery(
      `SELECT id, nombre, puntos_trivia AS puntos, tiempo_trivia AS tiempo
       FROM usuarios
       WHERE puntos_trivia > 0
       ORDER BY puntos_trivia DESC, fecha_registro ASC, id ASC
       LIMIT ?`,
      [limite]
    );
    let pos = 0;
    let previo = null;
    const ranking = filas.map((f, i) => {
      if (f.puntos !== previo) { pos = i + 1; previo = f.puntos; }
      return { posicion: pos, nombre: f.nombre, puntos: f.puntos, tiempo: f.tiempo, tu: uid != null && f.id === uid };
    });

    const t = await dbQuery('SELECT COUNT(*) AS n FROM usuarios WHERE puntos_trivia > 0');
    let mio = null;
    if (uid != null) {
      const m = await dbQuery('SELECT puntos_trivia AS puntos, tiempo_trivia AS tiempo FROM usuarios WHERE id = ?', [uid]);
      if (m.length && m[0].puntos > 0) {
        mio = { puntos: m[0].puntos, tiempo: m[0].tiempo, posicion: (await puestoDe(m[0].puntos)).posicion };
      }
    }
    res.json({ total: Number(t[0].n), ranking, mio });
  } catch (e) {
    errorTrivia(res, e);
  }
});

// Puesto que ocuparía un puntaje (sirve también para quien no inició sesión)
app.get('/api/trivia/posicion', async (req, res) => {
  const puntos = Number(req.query.puntos);
  if (!Number.isInteger(puntos) || puntos < 0 || puntos > TRIVIA_MAX_PUNTOS) {
    return res.status(400).json({ error: 'Puntos inválidos' });
  }
  try {
    await asegurarColumnaTrivia();
    res.json(await puestoDe(puntos));
  } catch (e) {
    errorTrivia(res, e);
  }
});

// Guardar los puntos de una partida (se conserva el MEJOR puntaje, junto
// con el tiempo de ESA misma partida — nunca se mezclan tiempos y puntajes
// de partidas distintas).
const TRIVIA_MAX_TIEMPO = 24 * 60 * 60; // tope defensivo: 1 día en segundos

app.post('/api/trivia/puntos', async (req, res) => {
  const puntos = Number(req.body && req.body.puntos);
  const tiempoCrudo = Number(req.body && req.body.tiempo);
  const tiempo = Number.isFinite(tiempoCrudo) && tiempoCrudo >= 0 && tiempoCrudo <= TRIVIA_MAX_TIEMPO
    ? Math.round(tiempoCrudo)
    : 0;
  if (!Number.isInteger(puntos) || puntos < 0 || puntos > TRIVIA_MAX_PUNTOS) {
    return res.status(400).json({ error: 'Puntos inválidos' });
  }
  try {
    await asegurarColumnaTrivia();
    const uid = await resolverUsuarioId(req.body);
    if (uid == null) return res.status(401).json({ error: 'Ingresá con tu cuenta para guardar tus puntos' });

    const antes = await dbQuery(
      'SELECT puntos_trivia AS puntos, tiempo_trivia AS tiempo FROM usuarios WHERE id = ?',
      [uid]
    );
    const previo = antes.length ? antes[0].puntos : 0;
    const mejorado = puntos > previo;
    if (mejorado) {
      await dbQuery('UPDATE usuarios SET puntos_trivia = ?, tiempo_trivia = ? WHERE id = ?', [
        puntos,
        tiempo,
        uid,
      ]);
    }
    const mejor = mejorado ? puntos : previo;
    const mejorTiempo = mejorado ? tiempo : antes.length ? antes[0].tiempo : 0;
    const { posicion, total } = await puestoDe(mejor);
    res.json({ mejor, mejorTiempo, mejorado, posicion, total });
  } catch (e) {
    errorTrivia(res, e);
  }
});


const PORT = process.env.PORT || 3000;
// 0.0.0.0 = escuchar en todas las interfaces, imprescindible para que
// Codespaces / contenedores / VPS puedan reenviar el puerto hacia afuera.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`San Telmo Verde escuchando en el puerto ${PORT}`);
  console.log(`Local:  http://localhost:${PORT}`);
  console.log('Abrí la URL pública asignada por tu entorno (Codespaces, etc.) — nunca file://.');
});
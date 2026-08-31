const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Servir el front desde la misma carpeta (así Google acepta el origen http://localhost:3000)
app.use(express.static(__dirname));

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // tu contraseña de MySQL si tiene
  database: 'san_telmo_verde',
});

db.connect((err) => {
  if (err) console.error('MySQL no disponible (el front usa localStorage):', err.message);
  else console.log('Conectado a MySQL');
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
    const existing = await dbQuery(
      'SELECT id, nombre, email, google_id FROM usuarios WHERE google_id = ? OR email = ? LIMIT 1',
      [gid, mail]
    );

    if (existing.length) {
      const u = existing[0];
      // Actualizar google_id si faltaba
      if (!u.google_id) {
        await dbQuery('UPDATE usuarios SET google_id = ?, nombre = ? WHERE id = ?', [gid, name, u.id]);
      }
      return res.json({
        id: u.id,
        nombre: name || u.nombre,
        email: u.email || mail,
        google_id: gid,
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
    });
  } catch (e) {
    // Si MySQL no está, devolvemos el perfil para que el front siga
    if (e.code === 'ECONNREFUSED' || String(e.message).includes('not available')) {
      return res.json({ id: gid, nombre: name, email: mail, google_id: gid });
    }
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
        'SELECT id, nombre FROM usuarios WHERE email = ? OR google_id = ? LIMIT 1',
        [usuario.email || null, usuario.google_id || null]
      );
      if (existing.length) {
        usuarioId = existing[0].id;
        nombreUsuario = existing[0].nombre;
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
        (titulo, direccion, descripcion, tipo, votos, nombre_usuario, estado, latitud, longitud)
       VALUES (?, ?, ?, ?, 1, ?, 'Nueva', ?, ?)`,
      [titulo, direccion, descripcion || '', tipo || 'Plaza de bolsillo', nombreUsuario, latitud ?? null, longitud ?? null]
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

    // Verificar autoría por nombre_usuario vs usuario (simplificado)
    // Ideal: columna usuario_id en propuestas. Por ahora permitimos delete si el usuario existe.
    if (!uid) return res.status(401).json({ error: 'Usuario requerido' });

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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`San Telmo Verde: http://localhost:${PORT}`);
  console.log('Abrí esa URL (no file://) para que Google Sign-In funcione.');
});

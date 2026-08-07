/** Inicio y cierre de sesión. */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, auditar } = require('../db');
const { firmarToken, requiereSesion, limitadorLogin } = require('../middleware/seguridad');

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

router.post('/login', limitadorLogin, async (req, res) => {
  const { usuario, password } = req.body || {};
  const ip = req.ip;

  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }

  try {
    const [filas] = await pool.query('SELECT * FROM usuarios WHERE usuario = ? LIMIT 1', [usuario]);
    const u = filas[0];

    // Respuesta genérica: no revelamos si el usuario existe o no.
    if (!u || !u.activo) {
      await auditar(usuario, 'LOGIN_FALLIDO', 'usuario inexistente o inactivo', ip);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      return res.status(423).json({ error: 'Cuenta bloqueada temporalmente. Reintente en unos minutos.' });
    }

    const coincide = await bcrypt.compare(password, u.password_hash);
    if (!coincide) {
      const intentos = u.intentos_fallidos + 1;
      const bloquear = intentos >= MAX_INTENTOS;
      await pool.query(
        'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?',
        [bloquear ? 0 : intentos, bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60000) : null, u.id]
      );
      await auditar(usuario, 'LOGIN_FALLIDO', `intento ${intentos}`, ip);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    await pool.query(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW() WHERE id = ?',
      [u.id]
    );
    await auditar(usuario, 'LOGIN_OK', `rol ${u.rol}`, ip);

    const token = firmarToken(u);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({
      ok: true,
      usuario: { id: u.id, usuario: u.usuario, rol: u.rol, nombre: u.nombre_completo }
    });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Error del servidor al validar las credenciales' });
  }
});

router.post('/logout', requiereSesion, async (req, res) => {
  await auditar(req.usuario.usuario, 'LOGOUT', null, req.ip);
  res.clearCookie('token');
  res.json({ ok: true, mensaje: 'Sesión cerrada' });
});

router.get('/yo', requiereSesion, (req, res) => res.json({ usuario: req.usuario }));

module.exports = router;

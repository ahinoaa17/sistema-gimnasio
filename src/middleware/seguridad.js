/**
 * MÓDULO DE SEGURIDAD
 * - Autenticación por JWT firmado, guardado en cookie httpOnly.
 * - Autorización por rol (ADMINISTRADOR / CLIENTE).
 * - Limitador de intentos de inicio de sesión.
 */
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const SECRETO = process.env.JWT_SECRET || 'secreto-de-desarrollo-no-usar-en-produccion';

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, usuario: usuario.usuario, rol: usuario.rol, nombre: usuario.nombre_completo },
    SECRETO,
    { expiresIn: process.env.JWT_EXPIRA || '8h' }
  );
}

/** Exige sesión válida. */
function requiereSesion(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Sesión no iniciada' });
  try {
    req.usuario = jwt.verify(token, SECRETO);
    next();
  } catch {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
}

/** Exige uno de los roles indicados. */
function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sesión no iniciada' });
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tiene permisos para esta operación' });
    }
    next();
  };
}

/** Máximo 6 intentos de login cada 10 minutos por IP. */
const limitadorLogin = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Intente de nuevo en 10 minutos.' }
});

module.exports = { firmarToken, requiereSesion, requiereRol, limitadorLogin };

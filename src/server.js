/**
 * ======================================================================
 *  CÓNDOR IRON GYM · Servidor principal
 *  Node.js + Express · Base de datos MySQL alojada en Amazon RDS
 *  Ahinoa Andino — PUCE
 * ======================================================================
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { probarConexion } = require('./db');

const app = express();
const PUERTO = process.env.PORT || 3000;

/* ------------------------- Seguridad base ------------------------- */
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:']
    }
  }
}));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ---------------------------- Rutas API --------------------------- */
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/clientes',    require('./routes/clientes'));
app.use('/api/membresias',  require('./routes/membresias'));
app.use('/api/asistencias', require('./routes/asistencias'));
app.use('/api/dashboard',   require('./routes/dashboard'));

/* --------------------------- Diagnóstico -------------------------- */
app.get('/api/salud', async (req, res) => {
  try {
    const info = await probarConexion();
    res.json({ estado: 'ok', bd: 'conectada', motor: info.version, host: process.env.DB_HOST });
  } catch (e) {
    res.status(503).json({ estado: 'degradado', bd: 'sin conexión', detalle: e.message });
  }
});

/* --------------------------- Front-end ---------------------------- */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));

/* --------------------- Manejo de errores -------------------------- */
app.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

/* ----------------------------- Arranque --------------------------- */
if (require.main === module) {
  app.listen(PUERTO, async () => {
    console.log('======================================================');
    console.log('  CÓNDOR IRON GYM — sistema de gestión');
    console.log(`  Escuchando en el puerto ${PUERTO}`);
    console.log('======================================================');
    try {
      await probarConexion();
    } catch (e) {
      console.error('[RDS] No se pudo conectar:', e.message);
      console.error('      Revise DB_HOST, credenciales y el grupo de seguridad en AWS.');
    }
  });
}

module.exports = app;

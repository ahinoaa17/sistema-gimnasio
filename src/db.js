/**
 * Conexión a la base de datos alojada en Amazon RDS (MySQL 8.0).
 * Se usa un pool para reutilizar conexiones y no saturar la instancia free tier.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'condor_gym',
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: ['DATE'],
  // RDS acepta TLS; en producción conviene cargar el bundle de certificados de AWS.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function probarConexion() {
  const conn = await pool.getConnection();
  try {
    const [[info]] = await conn.query(
      'SELECT VERSION() AS version, DATABASE() AS bd, @@hostname AS servidor'
    );
    console.log(`[RDS] Conectado a ${process.env.DB_HOST}`);
    console.log(`[RDS] MySQL ${info.version} · BD "${info.bd}" · host ${info.servidor}`);
    return info;
  } finally {
    conn.release();
  }
}

/** Registra una acción en la bitácora de seguridad. */
async function auditar(usuario, accion, detalle, ip) {
  try {
    await pool.query(
      'INSERT INTO bitacora (usuario, accion, detalle, ip) VALUES (?,?,?,?)',
      [usuario || 'anonimo', accion, detalle || null, ip || null]
    );
  } catch (e) {
    console.error('[bitacora]', e.message);
  }
}

module.exports = { pool, probarConexion, auditar };

/** Indicadores del panel principal. */
const router = require('express').Router();
const { pool } = require('../db');
const { requiereSesion, requiereRol } = require('../middleware/seguridad');

router.use(requiereSesion, requiereRol('ADMINISTRADOR'));

router.get('/', async (req, res) => {
  const [[totales]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM clientes)                                   AS total_clientes,
      (SELECT COUNT(*) FROM clientes WHERE estado='ACTIVO')             AS clientes_activos,
      (SELECT COUNT(*) FROM clientes WHERE estado='INACTIVO')           AS clientes_inactivos,
      (SELECT COUNT(*) FROM membresias
        WHERE estado='ACTIVA' AND fecha_vencimiento >= CURDATE())       AS membresias_activas,
      (SELECT COUNT(*) FROM membresias
        WHERE estado<>'CANCELADA' AND fecha_vencimiento < CURDATE())    AS membresias_vencidas,
      (SELECT COUNT(*) FROM membresias
        WHERE estado='ACTIVA'
          AND fecha_vencimiento BETWEEN CURDATE() AND CURDATE()+INTERVAL 7 DAY) AS por_vencer,
      (SELECT COUNT(*) FROM asistencias WHERE DATE(fecha_hora)=CURDATE())       AS asistencias_hoy,
      (SELECT COUNT(*) FROM asistencias
        WHERE fecha_hora >= CURDATE()-INTERVAL 30 DAY)                  AS asistencias_mes,
      (SELECT COUNT(*) FROM asistencias)                                AS asistencias_total,
      (SELECT COUNT(*) FROM asistencias
        WHERE resultado='RECHAZADA' AND fecha_hora >= CURDATE()-INTERVAL 30 DAY) AS rechazos_mes,
      (SELECT IFNULL(SUM(monto),0) FROM pagos
        WHERE fecha_pago >= CURDATE()-INTERVAL 30 DAY)                  AS ingresos_mes
  `);

  // Asistencias de los últimos 7 días para el gráfico
  const [serie] = await pool.query(`
    SELECT DATE(fecha_hora) AS dia, COUNT(*) AS total
      FROM asistencias
     WHERE fecha_hora >= CURDATE() - INTERVAL 6 DAY AND resultado='PERMITIDA'
     GROUP BY DATE(fecha_hora)
     ORDER BY dia
  `);

  // Distribución por tipo de membresía
  const [porTipo] = await pool.query(`
    SELECT t.nombre AS tipo, COUNT(m.id) AS total
      FROM tipos_membresia t
      LEFT JOIN membresias m ON m.tipo_id = t.id
                            AND m.estado='ACTIVA' AND m.fecha_vencimiento >= CURDATE()
     WHERE t.activo = 1
     GROUP BY t.id, t.nombre
     ORDER BY total DESC
  `);

  // Próximos vencimientos
  const [vencimientos] = await pool.query(`
    SELECT CONCAT(c.nombres,' ',c.apellidos) AS cliente, c.cedula,
           t.nombre AS tipo, m.fecha_vencimiento,
           DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias
      FROM membresias m
      JOIN clientes c ON c.id = m.cliente_id
      JOIN tipos_membresia t ON t.id = m.tipo_id
     WHERE m.estado='ACTIVA' AND m.fecha_vencimiento >= CURDATE()
     ORDER BY m.fecha_vencimiento ASC LIMIT 6
  `);

  res.json({ totales, serie, porTipo, vencimientos });
});

/** Bitácora de seguridad */
router.get('/bitacora', async (req, res) => {
  const [filas] = await pool.query(
    'SELECT * FROM bitacora ORDER BY fecha_hora DESC LIMIT 100'
  );
  res.json(filas);
});

module.exports = router;

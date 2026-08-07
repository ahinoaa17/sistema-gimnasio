/**
 * Control de asistencia.
 * Regla central del examen: NO se permite la entrada si la membresía está vencida.
 * Todo intento —permitido o rechazado— queda registrado.
 */
const router = require('express').Router();
const { pool, auditar } = require('../db');
const { requiereSesion, requiereRol } = require('../middleware/seguridad');

router.use(requiereSesion);

/** Registrar entrada por cédula. Valida vigencia antes de permitir el acceso. */
router.post('/entrada', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const { cedula } = req.body;
  if (!cedula) return res.status(400).json({ error: 'Debe ingresar la cédula del cliente' });

  const [[v]] = await pool.query(
    'SELECT * FROM v_membresia_vigente WHERE cedula = ? LIMIT 1', [cedula]
  );

  if (!v) return res.status(404).json({ error: 'No existe un cliente con esa cédula' });

  // --- Validaciones de acceso -------------------------------------
  let permitido = true;
  let motivo = 'Acceso autorizado';

  if (v.estado_cliente === 'INACTIVO') {
    permitido = false;
    motivo = 'Cliente desactivado';
  } else if (v.situacion === 'SIN_MEMBRESIA') {
    permitido = false;
    motivo = 'El cliente no tiene ninguna membresía registrada';
  } else if (v.situacion === 'CANCELADA') {
    permitido = false;
    motivo = 'La membresía fue cancelada';
  } else if (v.situacion === 'VENCIDA') {
    permitido = false;
    motivo = `Membresía vencida el ${v.fecha_vencimiento} (hace ${Math.abs(v.dias_restantes)} días)`;
  }

  await pool.query(
    'INSERT INTO asistencias (cliente_id, membresia_id, resultado, observacion) VALUES (?,?,?,?)',
    [v.cliente_id, v.membresia_id || null, permitido ? 'PERMITIDA' : 'RECHAZADA', motivo]
  );
  await auditar(req.usuario.usuario, permitido ? 'ACCESO_PERMITIDO' : 'ACCESO_RECHAZADO',
    `${v.cedula} · ${motivo}`, req.ip);

  const carga = {
    permitido,
    motivo,
    cliente: v.cliente,
    cedula: v.cedula,
    membresia: v.tipo,
    vence: v.fecha_vencimiento,
    dias_restantes: v.dias_restantes,
    hora: new Date().toLocaleTimeString('es-EC', { hour12: false })
  };

  return res.status(permitido ? 201 : 403).json(carga);
});

/** Consultar asistencias. Filtros: ?desde=&hasta=&cliente_id=&resultado= */
router.get('/', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const { desde, hasta, cliente_id, resultado } = req.query;
  const cond = [], params = [];

  if (desde)      { cond.push('DATE(a.fecha_hora) >= ?'); params.push(desde); }
  if (hasta)      { cond.push('DATE(a.fecha_hora) <= ?'); params.push(hasta); }
  if (cliente_id) { cond.push('a.cliente_id = ?');        params.push(cliente_id); }
  if (resultado)  { cond.push('a.resultado = ?');         params.push(resultado); }

  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const [filas] = await pool.query(
    `SELECT a.id, a.fecha_hora, a.resultado, a.observacion,
            c.cedula, CONCAT(c.nombres,' ',c.apellidos) AS cliente
       FROM asistencias a
       JOIN clientes c ON c.id = a.cliente_id
       ${where}
      ORDER BY a.fecha_hora DESC
      LIMIT 300`, params
  );
  res.json(filas);
});

/** Historial propio del cliente autenticado */
router.get('/mias', async (req, res) => {
  const [filas] = await pool.query(
    `SELECT a.fecha_hora, a.resultado, a.observacion
       FROM asistencias a
       JOIN clientes c ON c.id = a.cliente_id
      WHERE c.usuario_id = ?
      ORDER BY a.fecha_hora DESC LIMIT 100`,
    [req.usuario.id]
  );
  res.json(filas);
});

module.exports = router;

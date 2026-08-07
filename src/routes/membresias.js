/** Gestión de membresías: tipos, asignación, vigencia. */
const router = require('express').Router();
const { pool, auditar } = require('../db');
const { requiereSesion, requiereRol } = require('../middleware/seguridad');

router.use(requiereSesion);

/* ---------------------- TIPOS DE MEMBRESÍA ---------------------- */

router.get('/tipos', async (req, res) => {
  const [filas] = await pool.query('SELECT * FROM tipos_membresia WHERE activo = 1 ORDER BY duracion_dias');
  res.json(filas);
});

/** Crear tipo de membresía */
router.post('/tipos', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const { nombre, descripcion, duracion_dias, precio } = req.body;
  if (!nombre || !duracion_dias || precio === undefined) {
    return res.status(400).json({ error: 'Nombre, duración y precio son obligatorios' });
  }
  if (Number(duracion_dias) < 1) return res.status(400).json({ error: 'La duración debe ser de al menos 1 día' });
  if (Number(precio) < 0) return res.status(400).json({ error: 'El precio no puede ser negativo' });

  try {
    const [r] = await pool.query(
      'INSERT INTO tipos_membresia (nombre, descripcion, duracion_dias, precio) VALUES (?,?,?,?)',
      [nombre, descripcion || null, duracion_dias, precio]
    );
    await auditar(req.usuario.usuario, 'TIPO_MEMBRESIA_CREADO', nombre, req.ip);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un tipo con ese nombre' });
    res.status(500).json({ error: 'No se pudo crear el tipo de membresía' });
  }
});

router.delete('/tipos/:id', requiereRol('ADMINISTRADOR'), async (req, res) => {
  await pool.query('UPDATE tipos_membresia SET activo = 0 WHERE id = ?', [req.params.id]);
  await auditar(req.usuario.usuario, 'TIPO_MEMBRESIA_BAJA', `id ${req.params.id}`, req.ip);
  res.json({ ok: true });
});

/* ---------------------- MEMBRESÍAS ASIGNADAS ---------------------- */

/** Listado con estado calculado */
router.get('/', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const [filas] = await pool.query(
    `SELECT m.id, m.cliente_id, CONCAT(c.nombres,' ',c.apellidos) AS cliente, c.cedula,
            t.nombre AS tipo, t.precio, m.fecha_inicio, m.fecha_vencimiento,
            DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias_restantes,
            CASE WHEN m.estado='CANCELADA' THEN 'CANCELADA'
                 WHEN m.fecha_vencimiento < CURDATE() THEN 'VENCIDA'
                 ELSE 'ACTIVA' END AS situacion
       FROM membresias m
       JOIN clientes c ON c.id = m.cliente_id
       JOIN tipos_membresia t ON t.id = m.tipo_id
      ORDER BY m.fecha_vencimiento DESC`
  );
  res.json(filas);
});

/** Asignar membresía a un cliente. La fecha de vencimiento se calcula sola. */
router.post('/', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const { cliente_id, tipo_id, fecha_inicio, metodo_pago } = req.body;
  if (!cliente_id || !tipo_id) {
    return res.status(400).json({ error: 'Debe indicar el cliente y el tipo de membresía' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cliente]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [cliente_id]);
    if (!cliente) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
    if (cliente.estado === 'INACTIVO') {
      throw Object.assign(new Error('No se puede asignar una membresía a un cliente inactivo'), { status: 400 });
    }

    const [[tipo]] = await conn.query('SELECT * FROM tipos_membresia WHERE id = ? AND activo = 1', [tipo_id]);
    if (!tipo) throw Object.assign(new Error('Tipo de membresía no válido'), { status: 404 });

    const inicio = fecha_inicio || new Date().toISOString().slice(0, 10);

    const [r] = await conn.query(
      `INSERT INTO membresias (cliente_id, tipo_id, fecha_inicio, fecha_vencimiento, estado)
       VALUES (?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), 'ACTIVA')`,
      [cliente_id, tipo_id, inicio, inicio, tipo.duracion_dias]
    );

    await conn.query(
      'INSERT INTO pagos (membresia_id, monto, metodo, referencia) VALUES (?,?,?,?)',
      [r.insertId, tipo.precio, metodo_pago || 'EFECTIVO', `MEM-${String(r.insertId).padStart(5, '0')}`]
    );

    await conn.commit();
    await auditar(req.usuario.usuario, 'MEMBRESIA_ASIGNADA',
      `cliente ${cliente_id} · ${tipo.nombre}`, req.ip);

    const [[creada]] = await pool.query(
      'SELECT fecha_inicio, fecha_vencimiento FROM membresias WHERE id = ?', [r.insertId]);
    res.status(201).json({ ok: true, id: r.insertId, ...creada, precio: tipo.precio });
  } catch (e) {
    await conn.rollback();
    res.status(e.status || 500).json({ error: e.message || 'No se pudo asignar la membresía' });
  } finally {
    conn.release();
  }
});

/** Renovar: extiende desde el vencimiento si aún está vigente. */
router.post('/:id/renovar', requiereRol('ADMINISTRADOR'), async (req, res) => {
  const [[m]] = await pool.query('SELECT * FROM membresias WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Membresía no encontrada' });

  const [[tipo]] = await pool.query('SELECT * FROM tipos_membresia WHERE id = ?', [m.tipo_id]);
  const hoy = new Date().toISOString().slice(0, 10);
  const base = m.fecha_vencimiento > hoy ? m.fecha_vencimiento : hoy;

  const [r] = await pool.query(
    `INSERT INTO membresias (cliente_id, tipo_id, fecha_inicio, fecha_vencimiento, estado)
     VALUES (?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), 'ACTIVA')`,
    [m.cliente_id, m.tipo_id, base, base, tipo.duracion_dias]
  );
  await pool.query('INSERT INTO pagos (membresia_id, monto, metodo, referencia) VALUES (?,?,?,?)',
    [r.insertId, tipo.precio, 'EFECTIVO', `REN-${String(r.insertId).padStart(5, '0')}`]);

  await auditar(req.usuario.usuario, 'MEMBRESIA_RENOVADA', `id ${req.params.id}`, req.ip);
  res.status(201).json({ ok: true, id: r.insertId });
});

router.patch('/:id/cancelar', requiereRol('ADMINISTRADOR'), async (req, res) => {
  await pool.query("UPDATE membresias SET estado='CANCELADA' WHERE id = ?", [req.params.id]);
  await auditar(req.usuario.usuario, 'MEMBRESIA_CANCELADA', `id ${req.params.id}`, req.ip);
  res.json({ ok: true });
});

/** Membresías del cliente que ha iniciado sesión (rol CLIENTE) */
router.get('/mias', async (req, res) => {
  const [filas] = await pool.query(
    `SELECT t.nombre AS tipo, m.fecha_inicio, m.fecha_vencimiento,
            DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias_restantes,
            CASE WHEN m.fecha_vencimiento < CURDATE() THEN 'VENCIDA' ELSE m.estado END AS situacion
       FROM membresias m
       JOIN tipos_membresia t ON t.id = m.tipo_id
       JOIN clientes c ON c.id = m.cliente_id
      WHERE c.usuario_id = ?
      ORDER BY m.fecha_vencimiento DESC`,
    [req.usuario.id]
  );
  res.json(filas);
});

module.exports = router;

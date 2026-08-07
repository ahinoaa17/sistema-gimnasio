/** Gestión de clientes — exclusiva del rol ADMINISTRADOR. */
const router = require('express').Router();
const { pool, auditar } = require('../db');
const { requiereSesion, requiereRol } = require('../middleware/seguridad');

router.use(requiereSesion, requiereRol('ADMINISTRADOR'));

/** Buscar / listar clientes. ?q=texto  &estado=ACTIVO|INACTIVO */
router.get('/', async (req, res) => {
  const { q = '', estado = '' } = req.query;
  const cond = [];
  const params = [];

  if (q.trim()) {
    cond.push('(c.nombres LIKE ? OR c.apellidos LIKE ? OR c.cedula LIKE ? OR c.correo LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (estado) { cond.push('c.estado = ?'); params.push(estado); }

  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const [filas] = await pool.query(
    `SELECT c.*, v.situacion, v.tipo AS membresia_tipo, v.fecha_vencimiento, v.dias_restantes
       FROM clientes c
       LEFT JOIN v_membresia_vigente v ON v.cliente_id = c.id
       ${where}
       ORDER BY c.apellidos, c.nombres`,
    params
  );
  res.json(filas);
});

router.get('/:id', async (req, res) => {
  const [[cliente]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(cliente);
});

/** Registrar cliente */
router.post('/', async (req, res) => {
  const { cedula, nombres, apellidos, telefono, correo, fecha_nac, genero, direccion, contacto_emergencia } = req.body;

  if (!cedula || !nombres || !apellidos) {
    return res.status(400).json({ error: 'Cédula, nombres y apellidos son obligatorios' });
  }
  if (!/^\d{10,13}$/.test(cedula)) {
    return res.status(400).json({ error: 'La cédula debe tener entre 10 y 13 dígitos' });
  }

  try {
    const [r] = await pool.query(
      `INSERT INTO clientes (cedula, nombres, apellidos, telefono, correo, fecha_nac, genero, direccion, contacto_emergencia)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [cedula, nombres, apellidos, telefono || null, correo || null, fecha_nac || null,
       genero || 'O', direccion || null, contacto_emergencia || null]
    );
    await auditar(req.usuario.usuario, 'CLIENTE_CREADO', `id ${r.insertId} · ${cedula}`, req.ip);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un cliente con esa cédula' });
    console.error('[clientes.post]', e);
    res.status(500).json({ error: 'No se pudo registrar el cliente' });
  }
});

/** Editar cliente */
router.put('/:id', async (req, res) => {
  const campos = ['nombres','apellidos','telefono','correo','fecha_nac','genero','direccion','contacto_emergencia','estado'];
  const set = [], params = [];
  for (const c of campos) {
    if (req.body[c] !== undefined) { set.push(`${c} = ?`); params.push(req.body[c] || null); }
  }
  if (!set.length) return res.status(400).json({ error: 'No se enviaron campos para actualizar' });

  params.push(req.params.id);
  const [r] = await pool.query(`UPDATE clientes SET ${set.join(', ')} WHERE id = ?`, params);
  if (!r.affectedRows) return res.status(404).json({ error: 'Cliente no encontrado' });

  await auditar(req.usuario.usuario, 'CLIENTE_EDITADO', `id ${req.params.id}`, req.ip);
  res.json({ ok: true });
});

/** Desactivar cliente (baja lógica, conserva su historial) */
router.patch('/:id/desactivar', async (req, res) => {
  const [r] = await pool.query("UPDATE clientes SET estado='INACTIVO' WHERE id = ?", [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Cliente no encontrado' });
  await auditar(req.usuario.usuario, 'CLIENTE_DESACTIVADO', `id ${req.params.id}`, req.ip);
  res.json({ ok: true, mensaje: 'Cliente desactivado' });
});

router.patch('/:id/activar', async (req, res) => {
  await pool.query("UPDATE clientes SET estado='ACTIVO' WHERE id = ?", [req.params.id]);
  await auditar(req.usuario.usuario, 'CLIENTE_ACTIVADO', `id ${req.params.id}`, req.ip);
  res.json({ ok: true, mensaje: 'Cliente reactivado' });
});

/** Eliminar definitivamente */
router.delete('/:id', async (req, res) => {
  const [r] = await pool.query('DELETE FROM clientes WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Cliente no encontrado' });
  await auditar(req.usuario.usuario, 'CLIENTE_ELIMINADO', `id ${req.params.id}`, req.ip);
  res.json({ ok: true, mensaje: 'Cliente eliminado' });
});

module.exports = router;

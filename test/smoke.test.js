/**
 * Pruebas de humo — se ejecutan en la etapa de COMPILACIÓN del pipeline.
 * No requieren una base de datos real: se sustituye la capa de datos por un
 * doble en memoria, de modo que el pipeline pueda validar la lógica sin
 * exponer la instancia de RDS.
 *
 *   npm test
 */
process.env.JWT_SECRET = 'secreto-de-prueba';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');
const bcrypt = require('bcryptjs');

/* ---------------- Doble de la base de datos ---------------- */
const hoy = new Date();
const dias = (n) => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);

const datos = {
  usuarios: [{
    id: 1, usuario: 'admin', rol: 'ADMINISTRADOR', nombre_completo: 'Ahinoa Andino',
    password_hash: bcrypt.hashSync('Condor2026*', 10), activo: 1,
    intentos_fallidos: 0, bloqueado_hasta: null
  }],
  vigentes: [
    { cliente_id: 1, cedula: '1723456789', cliente: 'Mateo Rivera', estado_cliente: 'ACTIVO',
      membresia_id: 10, tipo: 'Trimestral Andes', fecha_vencimiento: dias(80), dias_restantes: 80, situacion: 'ACTIVA' },
    { cliente_id: 3, cedula: '1712345678', cliente: 'Sebastián Cruz', estado_cliente: 'ACTIVO',
      membresia_id: 12, tipo: 'Mensual Chimborazo', fecha_vencimiento: dias(-15), dias_restantes: -15, situacion: 'VENCIDA' }
  ]
};

const pool = {
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM usuarios WHERE usuario'))
      return [datos.usuarios.filter(u => u.usuario === params[0])];
    if (s.startsWith('SELECT * FROM v_membresia_vigente'))
      return [datos.vigentes.filter(v => v.cedula === params[0])];
    if (s.startsWith('UPDATE usuarios') || s.startsWith('INSERT INTO asistencias') ||
        s.startsWith('INSERT INTO bitacora'))
      return [{ affectedRows: 1, insertId: 99 }];
    return [[]];
  },
  async getConnection() {
    return { query: pool.query, beginTransaction: async () => {}, commit: async () => {},
             rollback: async () => {}, release: () => {} };
  }
};

// Inyectamos el doble antes de que las rutas carguen el módulo real
require.cache[require.resolve('../src/db')] = {
  id: require.resolve('../src/db'),
  filename: require.resolve('../src/db'),
  loaded: true,
  exports: { pool, probarConexion: async () => ({ version: '8.0-doble' }), auditar: async () => {} }
};

const app = require('../src/server');

/* ---------------- Utilidades de petición ---------------- */
let servidor, puerto, cookie = '';

const pedir = (metodo, ruta, cuerpo) => new Promise((resolve, reject) => {
  const datosJson = cuerpo ? JSON.stringify(cuerpo) : null;
  const req = http.request({
    host: '127.0.0.1', port: puerto, path: ruta, method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(datosJson && { 'Content-Length': Buffer.byteLength(datosJson) }),
      ...(cookie && { Cookie: cookie })
    }
  }, res => {
    let t = '';
    res.on('data', c => t += c);
    res.on('end', () => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
      resolve({ estado: res.statusCode, cuerpo: (() => { try { return JSON.parse(t); } catch { return t; } })() });
    });
  });
  req.on('error', reject);
  if (datosJson) req.write(datosJson);
  req.end();
});

/* ---------------- Casos de prueba ---------------- */
const casos = [];
const prueba = (nombre, fn) => casos.push({ nombre, fn });

prueba('El servidor responde y las rutas están montadas', async () => {
  const r = await pedir('GET', '/api/auth/yo');
  assert.strictEqual(r.estado, 401, 'sin sesión debe devolver 401');
});

prueba('Rechaza credenciales incorrectas', async () => {
  const r = await pedir('POST', '/api/auth/login', { usuario: 'admin', password: 'malaClave' });
  assert.strictEqual(r.estado, 401);
  assert.match(r.cuerpo.error, /incorrectas/i);
});

prueba('Rechaza el login con campos vacíos', async () => {
  const r = await pedir('POST', '/api/auth/login', { usuario: '', password: '' });
  assert.strictEqual(r.estado, 400);
});

prueba('Inicia sesión el administrador y devuelve su rol', async () => {
  const r = await pedir('POST', '/api/auth/login', { usuario: 'admin', password: 'Condor2026*' });
  assert.strictEqual(r.estado, 200);
  assert.strictEqual(r.cuerpo.usuario.rol, 'ADMINISTRADOR');
  assert.ok(cookie.startsWith('token='), 'debe emitir cookie de sesión');
});

prueba('Permite la entrada con membresía vigente', async () => {
  const r = await pedir('POST', '/api/asistencias/entrada', { cedula: '1723456789' });
  assert.strictEqual(r.estado, 201);
  assert.strictEqual(r.cuerpo.permitido, true);
});

prueba('NIEGA la entrada con membresía vencida', async () => {
  const r = await pedir('POST', '/api/asistencias/entrada', { cedula: '1712345678' });
  assert.strictEqual(r.estado, 403, 'una membresía vencida no puede ingresar');
  assert.strictEqual(r.cuerpo.permitido, false);
  assert.match(r.cuerpo.motivo, /vencida/i);
});

prueba('Devuelve 404 con una cédula inexistente', async () => {
  const r = await pedir('POST', '/api/asistencias/entrada', { cedula: '0000000000' });
  assert.strictEqual(r.estado, 404);
});

prueba('Cierra la sesión correctamente', async () => {
  const r = await pedir('POST', '/api/auth/logout');
  assert.strictEqual(r.estado, 200);
  cookie = '';
  const r2 = await pedir('GET', '/api/auth/yo');
  assert.strictEqual(r2.estado, 401, 'tras cerrar sesión el acceso debe quedar bloqueado');
});

prueba('Protege los módulos de administración sin sesión', async () => {
  for (const ruta of ['/api/clientes', '/api/membresias', '/api/dashboard']) {
    const r = await pedir('GET', ruta);
    assert.strictEqual(r.estado, 401, `${ruta} debe exigir sesión`);
  }
});

/* ---------------- Ejecución ---------------- */
(async () => {
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  puerto = servidor.address().port;

  console.log('\n  CÓNDOR IRON GYM · pruebas de humo\n');
  let ok = 0, fallos = 0;

  for (const c of casos) {
    try {
      await c.fn();
      console.log(`  OK   ${c.nombre}`);
      ok++;
    } catch (e) {
      console.log(`  FALLA ${c.nombre}\n      ${e.message}`);
      fallos++;
    }
  }

  console.log(`\n  ${ok} correctas · ${fallos} fallidas\n`);
  servidor.close();
  process.exit(fallos ? 1 : 0);
})();

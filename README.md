# Cóndor Iron Gym — Sistema de gestión

Sistema web para administrar **clientes, membresías, pagos y asistencia** de un
gimnasio, con la base de datos alojada en **Amazon RDS (MySQL 8)** y un módulo
de seguridad con roles.

Corresponde a la **Parte 1** del examen práctico de Aplicaciones Distribuidas.

---

## Funcionalidades

### 1. Inicio de sesión
- Usuario y contraseña (hash **bcrypt**, nunca en texto plano)
- Roles **Administrador** y **Cliente**, con vistas distintas
- Cerrar sesión y expiración automática del token
- Bloqueo temporal tras 5 intentos fallidos y limitador por IP

### 2. Gestión de clientes *(rol administrador)*
- Registrar cliente
- Editar cliente
- Eliminar / desactivar cliente
- Buscar cliente (cédula, nombre, apellido o correo)

### 3. Gestión de membresías
- Crear tipos de membresía (nombre, duración, precio)
- Asignar membresía al cliente y registrar el pago
- Fecha de inicio
- **Fecha de vencimiento calculada automáticamente** según la duración del plan
- Renovación y cancelación

### 4. Control de asistencia
- Registrar entrada por cédula
- Consultar asistencias con filtros de fecha y resultado
- **Verifica que la membresía esté activa**
- **No permite la entrada si está vencida**, cancelada o el cliente está inactivo

### 5. Dashboard
- Total de clientes
- Membresías activas
- Membresías vencidas
- Asistencias (hoy, mes y total) con gráfico de los últimos 7 días
- Próximos vencimientos y distribución por plan

### AWS
- **Base de datos creada en AWS** — instancia MySQL 8 en Amazon RDS, región `us-east-1`
- **Aplicación conectada a la BD de AWS** — pool de conexiones `mysql2` con TLS;
  el endpoint `GET /api/salud` comprueba y reporta el estado de la conexión

---

## Arquitectura

```
Navegador  ──HTTPS──▶  Node.js + Express  ──TLS:3306──▶  Amazon RDS
(HTML/CSS/JS)          (API REST + JWT)                  MySQL 8 · us-east-1
```

| Capa | Tecnología |
|---|---|
| Front-end | HTML5, CSS3 y JavaScript sin frameworks |
| Back-end | Node.js 20 · Express 4 |
| Base de datos | MySQL 8 en Amazon RDS |
| Seguridad | bcrypt · JWT en cookie httpOnly · Helmet · rate-limit |

---

## Estructura

```
sistema-gimnasio/
├── src/
│   ├── server.js                 Servidor Express
│   ├── db.js                     Conexión con Amazon RDS y bitácora
│   ├── middleware/seguridad.js   JWT, roles y limitador de intentos
│   └── routes/
│       ├── auth.js               Inicio y cierre de sesión
│       ├── clientes.js           Gestión de clientes
│       ├── membresias.js         Tipos, asignación y renovación
│       ├── asistencias.js        Control de acceso
│       └── dashboard.js          Indicadores y bitácora
├── public/
│   ├── login.html                Pantalla de acceso
│   ├── panel.html                Panel de administración
│   ├── cliente.html              Portal del socio
│   ├── css/estilo.css            Hoja de estilos
│   └── js/panel.js               Lógica del panel
├── sql/schema.sql                Esquema y datos iniciales
└── test/smoke.test.js            Pruebas de humo
```

---

## Instalación

```bash
git clone https://github.com/ahinoaa17/sistema-gimnasio.git
cd sistema-gimnasio
npm install
cp .env.example .env      # completar con los datos de la instancia RDS
```

Cargar el esquema en RDS:

```bash
mysql -h TU-ENDPOINT.us-east-1.rds.amazonaws.com -u admin -p < sql/schema.sql
```

Arrancar:

```bash
npm start      # http://localhost:3000
npm test       # pruebas de humo
```

### Cuentas de prueba

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Condor2026*` | Administrador |
| `mrivera` | `Cliente2026*` | Cliente |

---

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Iniciar sesión |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/clientes?q=&estado=` | Buscar clientes |
| POST | `/api/clientes` | Registrar cliente |
| PUT | `/api/clientes/:id` | Editar cliente |
| PATCH | `/api/clientes/:id/desactivar` | Desactivar cliente |
| DELETE | `/api/clientes/:id` | Eliminar cliente |
| GET | `/api/membresias/tipos` | Listar tipos de membresía |
| POST | `/api/membresias/tipos` | Crear tipo de membresía |
| POST | `/api/membresias` | Asignar membresía |
| POST | `/api/asistencias/entrada` | Registrar entrada (valida vigencia) |
| GET | `/api/asistencias` | Consultar asistencias |
| GET | `/api/dashboard` | Indicadores del panel |
| GET | `/api/salud` | Estado de la conexión con RDS |

---

## Configuración de Git usada

```bash
git config --global user.name  "Ahinoa Andino"
git config --global user.email "aandinos@puce.edu.ec"
git init
git remote add origin https://github.com/ahinoaa17/sistema-gimnasio.git
git branch -M main
git add .
git commit -m "Subida inicial del sistema de gimnasio"
git push -u origin main
```

---

## Sitio informativo relacionado

La **Parte 2** del examen (página informativa con CI/CD hacia IIS) vive en el
repositorio [`gimnasio-informativa`](https://github.com/ahinoaa17/gimnasio-informativa).

---

**Autora:** Ahinoa Andino — Pontificia Universidad Católica del Ecuador

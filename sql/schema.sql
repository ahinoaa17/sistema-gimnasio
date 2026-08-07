-- =====================================================================
--  CÓNDOR IRON GYM  ·  Esquema de base de datos
--  Motor: MySQL 8.0  ·  Alojamiento: Amazon RDS (us-east-1)
--  Autora: Ahinoa Andino — PUCE
-- =====================================================================

CREATE DATABASE IF NOT EXISTS condor_gym
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE condor_gym;

-- ---------------------------------------------------------------------
-- 1. USUARIOS  (módulo de seguridad / inicio de sesión con roles)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  usuario         VARCHAR(60)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,          -- bcrypt, nunca texto plano
  rol             ENUM('ADMINISTRADOR','CLIENTE') NOT NULL DEFAULT 'CLIENTE',
  nombre_completo VARCHAR(120) NOT NULL,
  correo          VARCHAR(120) UNIQUE,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  intentos_fallidos TINYINT    NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME     NULL,
  ultimo_acceso   DATETIME     NULL,
  creado_en       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usuarios_rol (rol),
  INDEX idx_usuarios_activo (activo)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. CLIENTES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  cedula       VARCHAR(13)  NOT NULL UNIQUE,
  nombres      VARCHAR(80)  NOT NULL,
  apellidos    VARCHAR(80)  NOT NULL,
  telefono     VARCHAR(20),
  correo       VARCHAR(120),
  fecha_nac    DATE,
  genero       ENUM('M','F','O') DEFAULT 'O',
  direccion    VARCHAR(180),
  contacto_emergencia VARCHAR(120),
  estado       ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  usuario_id   INT NULL,
  creado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cliente_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_clientes_estado (estado),
  INDEX idx_clientes_busqueda (apellidos, nombres),
  FULLTEXT KEY ft_clientes (nombres, apellidos, cedula)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. TIPOS DE MEMBRESÍA
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_membresia (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60)  NOT NULL UNIQUE,
  descripcion VARCHAR(255),
  duracion_dias INT        NOT NULL,
  precio      DECIMAL(10,2) NOT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. MEMBRESÍAS ASIGNADAS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membresias (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id     INT NOT NULL,
  tipo_id        INT NOT NULL,
  fecha_inicio   DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  estado         ENUM('ACTIVA','VENCIDA','CANCELADA') NOT NULL DEFAULT 'ACTIVA',
  creado_en      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_memb_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_memb_tipo FOREIGN KEY (tipo_id)
    REFERENCES tipos_membresia(id),
  INDEX idx_memb_vigencia (cliente_id, fecha_vencimiento),
  INDEX idx_memb_estado (estado)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. PAGOS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  membresia_id INT NOT NULL,
  monto        DECIMAL(10,2) NOT NULL,
  metodo       ENUM('EFECTIVO','TARJETA','TRANSFERENCIA') NOT NULL DEFAULT 'EFECTIVO',
  fecha_pago   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  referencia   VARCHAR(60),
  CONSTRAINT fk_pago_membresia FOREIGN KEY (membresia_id)
    REFERENCES membresias(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. ASISTENCIAS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asistencias (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id   INT NOT NULL,
  fecha_hora   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  membresia_id INT NULL,
  resultado    ENUM('PERMITIDA','RECHAZADA') NOT NULL,
  observacion  VARCHAR(160),
  CONSTRAINT fk_asis_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON DELETE CASCADE,
  INDEX idx_asis_fecha (fecha_hora),
  INDEX idx_asis_cliente (cliente_id, fecha_hora)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. BITÁCORA DE SEGURIDAD (auditoría de accesos al sistema)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitacora (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  usuario    VARCHAR(60),
  accion     VARCHAR(80) NOT NULL,
  detalle    VARCHAR(255),
  ip         VARCHAR(45),
  fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bitacora_fecha (fecha_hora)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. VISTA: estado real de la membresía (fuente de verdad del control de acceso)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_membresia_vigente AS
SELECT  c.id                AS cliente_id,
        c.cedula,
        CONCAT(c.nombres,' ',c.apellidos) AS cliente,
        c.estado            AS estado_cliente,
        m.id                AS membresia_id,
        t.nombre            AS tipo,
        m.fecha_inicio,
        m.fecha_vencimiento,
        DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias_restantes,
        CASE
          WHEN m.id IS NULL                      THEN 'SIN_MEMBRESIA'
          WHEN m.estado = 'CANCELADA'            THEN 'CANCELADA'
          WHEN m.fecha_vencimiento < CURDATE()   THEN 'VENCIDA'
          ELSE 'ACTIVA'
        END AS situacion
FROM clientes c
LEFT JOIN membresias m
       ON m.id = (SELECT m2.id FROM membresias m2
                  WHERE m2.cliente_id = c.id
                  ORDER BY m2.fecha_vencimiento DESC LIMIT 1)
LEFT JOIN tipos_membresia t ON t.id = m.tipo_id;

-- ---------------------------------------------------------------------
-- 9. EVENTO: marca automáticamente como VENCIDAS las membresías expiradas
-- ---------------------------------------------------------------------
SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS ev_vencer_membresias;
CREATE EVENT ev_vencer_membresias
ON SCHEDULE EVERY 1 DAY
STARTS (CURRENT_DATE + INTERVAL 1 DAY)
DO
  UPDATE membresias
     SET estado = 'VENCIDA'
   WHERE estado = 'ACTIVA' AND fecha_vencimiento < CURDATE();

-- =====================================================================
--  DATOS INICIALES
--  Las contraseñas se guardan como hash bcrypt (coste 10).
--  admin / Condor2026*        mrivera / Cliente2026*
-- =====================================================================
INSERT IGNORE INTO usuarios (usuario, password_hash, rol, nombre_completo, correo) VALUES
('admin',  '$2a$10$y5/ZLxAlvrp.z1JBVXlXiuasKVlcr//cMSeBKjeA1XbHInzIvo29m', 'ADMINISTRADOR', 'Ahinoa Andino', 'aandinos@puce.edu.ec'),
('mrivera','$2a$10$bYNQqFrhX2I0PX5/vOSFfO1Nfwh8VtQVWpnhlF7XlJUHTd2DZAHEC', 'CLIENTE',       'Mateo Rivera',  'mrivera@correo.com');

INSERT IGNORE INTO tipos_membresia (nombre, descripcion, duracion_dias, precio) VALUES
('Diario Cóndor',     'Pase por un día, acceso a sala de pesas y cardio.',        1,   3.50),
('Mensual Chimborazo','Acceso ilimitado 30 días + evaluación física inicial.',    30,  25.00),
('Trimestral Andes',  '90 días, incluye 4 clases dirigidas al mes.',              90,  65.00),
('Semestral Antisana','180 días, incluye rutina personalizada y nutrición.',      180, 120.00),
('Anual Cotopaxi',    'Un año completo, casillero personal y acceso 24/7.',       365, 210.00);

INSERT IGNORE INTO clientes (cedula, nombres, apellidos, telefono, correo, fecha_nac, genero, direccion, contacto_emergencia) VALUES
('1723456789','Mateo','Rivera Salas','0987654321','mrivera@correo.com','1998-04-12','M','Av. 6 de Diciembre N24-30, Quito','Lucía Salas 0991112223'),
('1798765432','Camila','Vásquez León','0961122334','cvasquez@correo.com','2001-09-30','F','La Floresta, Quito','Jorge Vásquez 0987001122'),
('1712345678','Sebastián','Cruz Andrade','0999887766','scruz@correo.com','1995-01-22','M','Cumbayá, Quito','Ana Andrade 0988776655'),
('1755443322','Doménica','Paredes Ruiz','0968899001','dparedes@correo.com','2003-06-05','F','El Batán, Quito','Marco Paredes 0977665544');

UPDATE clientes SET usuario_id = (SELECT id FROM usuarios WHERE usuario='mrivera') WHERE cedula='1723456789';

-- Membresías de ejemplo: vigente, por vencer y ya vencida
INSERT IGNORE INTO membresias (cliente_id, tipo_id, fecha_inicio, fecha_vencimiento, estado) VALUES
(1, 3, CURDATE() - INTERVAL 10 DAY, CURDATE() + INTERVAL 80 DAY, 'ACTIVA'),
(2, 2, CURDATE() - INTERVAL 27 DAY, CURDATE() + INTERVAL  3 DAY, 'ACTIVA'),
(3, 2, CURDATE() - INTERVAL 45 DAY, CURDATE() - INTERVAL 15 DAY, 'VENCIDA'),
(4, 5, CURDATE() - INTERVAL  5 DAY, CURDATE() + INTERVAL 360 DAY,'ACTIVA');

INSERT IGNORE INTO pagos (membresia_id, monto, metodo, referencia) VALUES
(1, 65.00, 'TRANSFERENCIA', 'TRF-00891'),
(2, 25.00, 'EFECTIVO',      'EFE-00457'),
(3, 25.00, 'TARJETA',       'TAR-00120'),
(4, 210.00,'TRANSFERENCIA', 'TRF-00902');

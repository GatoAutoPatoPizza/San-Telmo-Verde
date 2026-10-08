-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 31-08-2026 a las 01:49:31
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `san_telmo_verde`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `denuncias`
--

CREATE TABLE `denuncias` (
  `id` int(11) NOT NULL,
  `propuesta_id` int(11) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `motivo` varchar(500) DEFAULT '',
  `estado` enum('pendiente','revisada','descartada') DEFAULT 'pendiente',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `fichas_mapa`
--

CREATE TABLE `fichas_mapa` (
  `id` int(11) NOT NULL,
  `titulo` varchar(255) NOT NULL,
  `descripcion` text NOT NULL,
  `tipo` varchar(50) NOT NULL,
  `etiqueta` varchar(100) NOT NULL,
  `coordenada_x` decimal(6,2) DEFAULT NULL,
  `coordenada_y` decimal(6,2) DEFAULT NULL,
  `estado_general` varchar(50) DEFAULT 'ACTIVO'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `propuestas`
--

CREATE TABLE `propuestas` (
  `id` int(11) NOT NULL,
  `titulo` varchar(255) NOT NULL,
  `direccion` varchar(255) NOT NULL,
  `descripcion` text NOT NULL,
  `tipo` varchar(100) NOT NULL,
  `votos` int(11) DEFAULT 1,
  `nombre_usuario` varchar(100) DEFAULT 'Anonimo',
  `usuario_id` int(11) DEFAULT NULL,
  `estado` enum('Nueva','En revisión','Aprobada','Archivada') DEFAULT 'Nueva',
  `latitud` decimal(10,7) DEFAULT NULL,
  `longitud` decimal(10,7) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
--
-- MIGRACIÓN: si tu base de datos ya existe y la tabla `propuestas`
-- fue creada ANTES de este cambio (sin columna usuario_id), corré
-- solo estas dos líneas una vez para agregarla sin perder datos:
--
-- ALTER TABLE `propuestas` ADD COLUMN `usuario_id` int(11) DEFAULT NULL AFTER `nombre_usuario`;
-- ALTER TABLE `propuestas` ADD KEY `usuario_id` (`usuario_id`);
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `google_id` varchar(255) DEFAULT NULL,
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  `puntos_trivia` int(11) NOT NULL DEFAULT 0,
  `tiempo_trivia` int(11) NOT NULL DEFAULT 0,
  `baneado_hasta` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `votos_propuesta`
--

CREATE TABLE `votos_propuesta` (
  `id` int(11) NOT NULL,
  `propuesta_id` int(11) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `fecha_voto` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- --------------------------------------------------------
--
-- Estructura de tabla para la tabla `zonas_mapa` (espacios verdes e islas de calor)
-- (El servidor también la crea y la carga solo al arrancar; esto es por si preferís importarla a mano.)
--

CREATE TABLE IF NOT EXISTS `zonas_mapa` (
  `id` varchar(50) NOT NULL,
  `tipo` enum('verde','calor') NOT NULL,
  `titulo` varchar(255) NOT NULL,
  `resumen` varchar(255) NOT NULL DEFAULT '',
  `detalle` text NOT NULL,
  `latitud` decimal(10,7) NOT NULL,
  `longitud` decimal(10,7) NOT NULL,
  `simbolo` varchar(5) NOT NULL DEFAULT '',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden` int(11) NOT NULL DEFAULT 0,
  `likes` int(11) NOT NULL DEFAULT 0,
  `creado_por` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Me gusta" de la comunidad a las zonas verdes (un like por usuario y zona).
-- Si zonas_mapa ya existía sin las columnas `likes` / `creado_por`, el servidor
-- las agrega solo al arrancar; no hace falta tocar nada a mano.
CREATE TABLE IF NOT EXISTS `likes_zona` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zona_id` varchar(50) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `like_unico` (`zona_id`,`usuario_id`),
  KEY `usuario_id` (`usuario_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `zonas_mapa` (`id`, `tipo`, `titulo`, `resumen`, `detalle`, `latitud`, `longitud`, `simbolo`) VALUES
  ('verde-lezama', 'verde', 'Parque Lezama', '7.2 ha · El más grande del barrio', 'El espacio verde más grande de San Telmo, con 7.2 hectáreas. Zona histórica con anfiteatro, el Museo Histórico Nacional y una gran variedad de árboles añosos.', -34.6289, -58.3697, 'P'),
  ('verde-dorrego', 'verde', 'Plazoleta Dorrego', '0.3 ha · Centro histórico', 'Plaza chica en pleno centro histórico de San Telmo, rodeada de anticuarios. Sede de la feria de los domingos.', -34.6212, -58.3731, ''),
  ('verde-humberto', 'verde', 'Plazoleta Calle Humberto', 'Pequeña plaza de barrio', 'Espacio verde chico sobre la calle Humberto Primo, de uso vecinal cotidiano.', -34.6175, -58.3720, ''),
  ('calor-norte', 'calor', 'Isla de calor · Zona norte', '+3.2°C', 'Zona con muy poca cobertura verde y alta densidad de construcción, lo que eleva la temperatura superficial respecto al resto del barrio.', -34.6165, -58.3775, ''),
  ('calor-centro', 'calor', 'Isla de calor · Zona central', '+2.8°C', 'Concentración de superficies de asfalto y hormigón sin arbolado que retienen calor durante el día y lo liberan de noche.', -34.6245, -58.3715, ''),
  ('calor-este', 'calor', 'Isla de calor · Zona este', '+4.1°C', 'La zona con mayor diferencia de temperatura registrada del barrio, cerca de la avenida Paseo Colón, con escasa vegetación.', -34.6195, -58.3675, '');

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `denuncias`
--
ALTER TABLE `denuncias`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `denuncia_unica` (`propuesta_id`,`usuario_id`),
  ADD KEY `usuario_id` (`usuario_id`);

--
-- Indices de la tabla `fichas_mapa`
--
ALTER TABLE `fichas_mapa`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `propuestas`
--
ALTER TABLE `propuestas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `usuario_id` (`usuario_id`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD UNIQUE KEY `google_id` (`google_id`);

--
-- Indices de la tabla `votos_propuesta`
--
ALTER TABLE `votos_propuesta`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `voto_unico` (`propuesta_id`,`usuario_id`),
  ADD KEY `usuario_id` (`usuario_id`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `denuncias`
--
ALTER TABLE `denuncias`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `fichas_mapa`
--
ALTER TABLE `fichas_mapa`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `propuestas`
--
ALTER TABLE `propuestas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `votos_propuesta`
--
ALTER TABLE `votos_propuesta`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `denuncias`
--
ALTER TABLE `denuncias`
  ADD CONSTRAINT `denuncias_ibfk_1` FOREIGN KEY (`propuesta_id`) REFERENCES `propuestas` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `denuncias_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE;

--
-- Filtros para la tabla `votos_propuesta`
--
ALTER TABLE `votos_propuesta`
  ADD CONSTRAINT `votos_propuesta_ibfk_1` FOREIGN KEY (`propuesta_id`) REFERENCES `propuestas` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `votos_propuesta_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
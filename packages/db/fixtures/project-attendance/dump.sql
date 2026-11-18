-- Synthetic mysqldump of the old project-attendance app, for ETL tests. Every name, NISN, NIP,
-- phone number and password hash here is invented. Shaped like `mysqldump` 8 default output.
--
-- Host: localhost    Database: project_attendance
-- ------------------------------------------------------
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `uuid` char(36) NOT NULL,
  `username` varchar(255) NOT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (1,'0b5f8a1e-0000-4000-8000-000000000001','budi',NULL,'$2y$10$SYNTHETICxHASHxNEVERxCOPYxME0000000000000000000000001',NULL,'2024-07-01 08:00:00','2024-07-01 08:00:00'),(2,'0b5f8a1e-0000-4000-8000-000000000002','siti',NULL,'$2y$10$SYNTHETICxHASHxNEVERxCOPYxME0000000000000000000000002',NULL,NULL,NULL),(3,'0b5f8a1e-0000-4000-8000-000000000003','rina',NULL,'$2y$10$SYNTHETICxHASHxNEVERxCOPYxME0000000000000000000000003',NULL,NULL,NULL);
UNLOCK TABLES;

DROP TABLE IF EXISTS `type_class`;
CREATE TABLE `type_class` (
  `id` char(36) NOT NULL,
  `category` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `type_class` VALUES ('t10','X',NULL,NULL),('t11','XI',NULL,NULL),('tal','Alumni',NULL,NULL);

DROP TABLE IF EXISTS `teacher`;
CREATE TABLE `teacher` (
  `id` char(36) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `nip` bigint NOT NULL,
  `name` varchar(255) NOT NULL,
  `gender` enum('L','P') NOT NULL,
  `telp` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `religion_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `teacher_user_id_foreign` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `teacher` VALUES ('g1',1,199001012020011001,'BUDI SANTOSA, S.Pd.','L','0812-1100-0001',NULL,NULL,NULL),('g2',2,0,'SITI NUR\'AINI','P',NULL,NULL,NULL,NULL),('g3',3,199202022020012002,'RINA  WATI','P','62813110000003',NULL,NULL,NULL);

DROP TABLE IF EXISTS `class_room`;
CREATE TABLE `class_room` (
  `id` char(36) NOT NULL,
  `class_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `type_class_id` char(36) DEFAULT NULL,
  `teacher_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `class_room` VALUES ('c1',1,'IPA 1',NULL,NULL,'t10','g1'),('c2',2,'IPS 1',NULL,NULL,'t11','g2'),('c3',1,'IPA 1',NULL,NULL,'tal','g3'),('c4',3,'IPA 1',NULL,NULL,'t10','g3');

DROP TABLE IF EXISTS `student`;
CREATE TABLE `student` (
  `id` char(36) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `student_id` bigint NOT NULL,
  `nisn` bigint NOT NULL,
  `name` varchar(255) NOT NULL,
  `gender` enum('L','P') NOT NULL,
  `day_of_birth` date DEFAULT NULL,
  `telp` varchar(255) DEFAULT NULL,
  `graduated` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `classroom_id` char(36) NOT NULL,
  `religion_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `student` VALUES ('s1',11,2601,991310001,'ADITYA PRATAMA','L','2010-02-11','081299990001',0,NULL,NULL,'c1',NULL),('s2',12,2602,9913100002,'DINDA O\'BRIEN','P','0000-00-00',NULL,0,NULL,NULL,'c1',NULL),('s3',13,2603,9913100003,'Citra  lestari','P','2009-05-01',NULL,0,NULL,NULL,'c2',NULL);
INSERT INTO `student` VALUES ('s4',14,2604,991310001,'ADITYA KEMBAR','L','2010-02-11',NULL,0,NULL,NULL,'c1',NULL),('s5',15,2605,0,'TANPA NISN','L',NULL,NULL,0,NULL,NULL,'c1',NULL),('s6',16,2606,9913100006,'ROMBEL ALUMNI','P',NULL,NULL,0,NULL,NULL,'c3',NULL),('s7',17,2607,9913100007,'SUDAH LULUS','L',NULL,NULL,1,NULL,NULL,'c2',NULL),('s8',18,2608,9913100008,'PINDAHAN SEPTEMBER','P','2009-09-09',NULL,0,NULL,NULL,'c2',NULL),('s9',19,2609,9913100009,'SUDAH DI ABSAH','L',NULL,NULL,0,NULL,NULL,'c2',NULL),('s10',20,2610,12345678901,'NISN KEPANJANGAN','P',NULL,NULL,0,NULL,NULL,'c2',NULL);

DROP TABLE IF EXISTS `student_class_histories`;
CREATE TABLE `student_class_histories` (
  `id` char(36) NOT NULL,
  `student_id` char(36) NOT NULL,
  `classroom_id` char(36) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `student_class_histories` VALUES ('h1','s1','c1','2024-07-15',NULL,NULL,NULL),('h2','s3','c1','2024-07-15','2025-06-30',NULL,NULL),('h3','s3','c2','2025-07-14',NULL,NULL,NULL),('h4','s8','c2','2026-09-01',NULL,NULL,NULL);

DROP TABLE IF EXISTS `attendance`;
CREATE TABLE `attendance` (
  `id` char(36) NOT NULL,
  `student_id` char(36) DEFAULT NULL,
  `time` timestamp NOT NULL,
  `hours` int NOT NULL,
  `is_spesialDay` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('alpha','present','sick','permission') NOT NULL DEFAULT 'present',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `attendance` VALUES ('a1','s1','2026-08-03 00:15:00',1,0,'present',NULL,NULL),('a2','s1','2026-08-03 01:00:00',2,0,'sick',NULL,NULL),('a3','s3','2026-08-03 00:15:00',1,0,'alpha',NULL,NULL);
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
-- Dump completed on 2026-11-17 10:00:00

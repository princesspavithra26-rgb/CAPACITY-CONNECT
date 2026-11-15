-- Run this only if an earlier CAPACITY CONNECT schema already exists.
-- Execute after selecting the capacity_connect database.
USE capacity_connect;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'difficulty');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE courses ADD COLUMN difficulty VARCHAR(40) DEFAULT ''Beginner'' AFTER status', 'SELECT ''courses.difficulty already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'duration');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE courses ADD COLUMN duration VARCHAR(80) NULL AFTER difficulty', 'SELECT ''courses.duration already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'max_learners');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE courses ADD COLUMN max_learners INT UNSIGNED NULL AFTER duration', 'SELECT ''courses.max_learners already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'objectives');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE courses ADD COLUMN objectives TEXT NULL AFTER max_learners', 'SELECT ''courses.objectives already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assessments' AND COLUMN_NAME = 'questions_json');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE assessments ADD COLUMN questions_json JSON NULL AFTER due_date', 'SELECT ''assessments.questions_json already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The latest schema.sql creates all supporting tables if they do not already exist.

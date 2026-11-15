-- CAPACITY CONNECT compatibility migration for the current backend.
-- Run this once against the existing capacity_connect database in TiDB Cloud.
-- It preserves existing rows and adds columns/tables expected by server.js.
USE capacity_connect;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'resources' AND COLUMN_NAME = 'module_id');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE resources ADD COLUMN module_id BIGINT UNSIGNED NULL AFTER course_id', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assessments' AND COLUMN_NAME = 'answer_key_json');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE assessments ADD COLUMN answer_key_json JSON NULL AFTER questions_json', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assessment_submissions' AND COLUMN_NAME = 'auto_check_json');
SET @ddl = IF(@column_exists = 0, 'ALTER TABLE assessment_submissions ADD COLUMN auto_check_json JSON NULL AFTER answers_json', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

CREATE TABLE IF NOT EXISTS resource_visits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  trainee_id BIGINT UNSIGNED NOT NULL,
  visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_resource_visit (resource_id, trainee_id),
  CONSTRAINT fk_resource_visit_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_resource_visit_trainee FOREIGN KEY (trainee_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Add the module foreign key only when it is not already present.
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'resources' AND CONSTRAINT_NAME = 'fk_resources_module');
SET @ddl = IF(@fk_exists = 0, 'ALTER TABLE resources ADD CONSTRAINT fk_resources_module FOREIGN KEY (module_id) REFERENCES course_modules(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

-- CAPACITY CONNECT: add assessment answer-key and automatic-check storage.
-- Run this once in MySQL Workbench with capacity_connect selected.
-- Existing assessments and submissions are preserved.

ALTER TABLE assessments
  ADD COLUMN answer_key_json JSON NULL AFTER questions_json;

ALTER TABLE assessment_submissions
  ADD COLUMN auto_check_json JSON NULL AFTER answers_json;

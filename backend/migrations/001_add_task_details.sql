-- Run this once in MySQL Workbench if you created the tasks table before this update.
ALTER TABLE tasks
    ADD COLUMN priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium' AFTER status,
    ADD COLUMN due_date DATE NULL AFTER priority;

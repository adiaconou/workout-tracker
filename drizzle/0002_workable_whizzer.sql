CREATE TABLE `exercise_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`equipment` text DEFAULT 'other' NOT NULL,
	`movement_pattern` text DEFAULT 'other' NOT NULL,
	`tracking_type` text DEFAULT 'reps' NOT NULL,
	`default_load_type` text DEFAULT 'external' NOT NULL,
	`side_mode` text DEFAULT 'bilateral' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_catalog_owner_name_idx` ON `exercise_catalog` (`owner_email`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `exercise_catalog_owner_active_idx` ON `exercise_catalog` (`owner_email`,`is_active`);--> statement-breakpoint
CREATE TABLE `exercise_muscles` (
	`exercise_id` text NOT NULL,
	`muscle_group` text NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	PRIMARY KEY(`exercise_id`, `muscle_group`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_catalog`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `routine_set_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`routine_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`set_type` text NOT NULL,
	`target_type` text DEFAULT 'reps' NOT NULL,
	`target_min` real,
	`target_max` real,
	`target_display` text NOT NULL,
	`target_rir_min` real,
	`target_rir_max` real,
	`rest_after_sec` integer DEFAULT 0 NOT NULL,
	`rest_rule` text DEFAULT 'standard' NOT NULL,
	`load_instruction` text DEFAULT '' NOT NULL,
	`side_mode` text DEFAULT 'bilateral' NOT NULL,
	`tempo` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`routine_exercise_id`) REFERENCES `routine_version_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_set_templates_position_idx` ON `routine_set_templates` (`routine_exercise_id`,`position`);--> statement-breakpoint
CREATE TABLE `routine_version_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`routine_version_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`superset_group` text,
	`instructions` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`routine_version_id`) REFERENCES `routine_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_catalog`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_version_exercises_position_idx` ON `routine_version_exercises` (`routine_version_id`,`position`);--> statement-breakpoint
CREATE INDEX `routine_version_exercises_exercise_idx` ON `routine_version_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `routine_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`routine_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`focus` text NOT NULL,
	`summary` text NOT NULL,
	`duration_min` integer DEFAULT 60 NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_versions_number_idx` ON `routine_versions` (`routine_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `routine_versions_owner_routine_idx` ON `routine_versions` (`owner_email`,`routine_id`);--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`source_routine_exercise_id` text,
	`position` integer NOT NULL,
	`exercise_name_snapshot` text NOT NULL,
	`load_type_snapshot` text NOT NULL,
	`side_mode_snapshot` text DEFAULT 'bilateral' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_routine_exercise_id`) REFERENCES `routine_version_exercises`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_exercises_position_idx` ON `workout_exercises` (`workout_id`,`position`);--> statement-breakpoint
CREATE INDEX `workout_exercises_exercise_idx` ON `workout_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`workout_id` text NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`source_routine_set_id` text,
	`prescribed_set_id` text NOT NULL,
	`position` integer NOT NULL,
	`set_type` text NOT NULL,
	`planned_target_type` text DEFAULT 'reps' NOT NULL,
	`planned_target_min` real,
	`planned_target_max` real,
	`planned_target_display` text NOT NULL,
	`planned_rir_min` real,
	`planned_rir_max` real,
	`planned_rest_sec` integer DEFAULT 0 NOT NULL,
	`planned_rest_rule` text DEFAULT 'standard' NOT NULL,
	`actual_reps` integer,
	`actual_reps_left` integer,
	`actual_reps_right` integer,
	`actual_duration_sec` integer,
	`actual_weight` real,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`actual_rir` real,
	`actual_rest_sec` integer,
	`rest_started_at` text,
	`rest_ended_at` text,
	`rest_skipped` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`completed_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_routine_set_id`) REFERENCES `routine_set_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_sets_prescribed_idx` ON `workout_sets` (`workout_id`,`prescribed_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workout_sets_position_idx` ON `workout_sets` (`workout_id`,`position`);--> statement-breakpoint
CREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`workout_exercise_id`);--> statement-breakpoint
ALTER TABLE `routines` ADD `current_version_id` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `routine_id` text;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `routine_version_id` text;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `body_weight` real;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `weight_unit` text DEFAULT 'lb' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `session_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `is_archived` integer DEFAULT false NOT NULL;
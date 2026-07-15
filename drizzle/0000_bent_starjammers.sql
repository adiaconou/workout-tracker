CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`routine_code` text NOT NULL,
	`exercise_order` integer NOT NULL,
	`name` text NOT NULL,
	`warmup` text NOT NULL,
	`warmup_sets` integer DEFAULT 0 NOT NULL,
	`regular_sets` integer DEFAULT 0 NOT NULL,
	`failure_sets` integer DEFAULT 0 NOT NULL,
	`drop_sets` integer DEFAULT 0 NOT NULL,
	`target` text NOT NULL,
	`rest` text NOT NULL,
	`effort` text NOT NULL,
	`purpose` text NOT NULL,
	`load_type` text DEFAULT 'external' NOT NULL,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_owner_routine_order_idx` ON `exercises` (`owner_email`,`routine_code`,`exercise_order`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`code` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`focus` text NOT NULL,
	`summary` text NOT NULL,
	`duration_min` integer DEFAULT 60 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routines_owner_code_idx` ON `routines` (`owner_email`,`code`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`routine_code` text NOT NULL,
	`routine_version` integer NOT NULL,
	`status` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`current_exercise` integer DEFAULT 1 NOT NULL,
	`current_set` integer DEFAULT 1 NOT NULL,
	`completed_sets` integer DEFAULT 0 NOT NULL,
	`skipped_sets` integer DEFAULT 0 NOT NULL,
	`total_sets` integer NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_session_per_owner` ON `workout_sessions` (`owner_email`) WHERE `status` = 'In Progress';

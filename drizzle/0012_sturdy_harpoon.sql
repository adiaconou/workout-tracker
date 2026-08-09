CREATE TABLE `routine_program_routines` (
	`program_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`program_id`, `routine_id`),
	FOREIGN KEY (`program_id`) REFERENCES `routine_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_program_routines_position_idx` ON `routine_program_routines` (`program_id`,`position`);--> statement-breakpoint
CREATE INDEX `routine_program_routines_routine_idx` ON `routine_program_routines` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routine_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`selected_muscle_groups_json` text DEFAULT '[]' NOT NULL,
	`training_days_per_week` integer NOT NULL,
	`target_duration_min` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`request_fingerprint` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_programs_owner_idempotency_idx` ON `routine_programs` (`owner_email`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `routine_programs_one_active_owner_idx` ON `routine_programs` (`owner_email`) WHERE "routine_programs"."is_active" = 1;--> statement-breakpoint
CREATE INDEX `routine_programs_owner_updated_idx` ON `routine_programs` (`owner_email`,`updated_at`);
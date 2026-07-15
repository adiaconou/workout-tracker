CREATE TABLE `set_performances` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`session_id` text NOT NULL,
	`prescribed_set_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`exercise_order` integer NOT NULL,
	`exercise_name` text NOT NULL,
	`set_order` integer NOT NULL,
	`set_type` text NOT NULL,
	`target_display` text NOT NULL,
	`target_rest_sec` integer NOT NULL,
	`rest_rule` text NOT NULL,
	`actual_reps` integer,
	`actual_duration_sec` integer,
	`actual_weight` real,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`status` text NOT NULL,
	`performed_at` text NOT NULL,
	`rest_skipped` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_performances_session_set_idx` ON `set_performances` (`session_id`,`prescribed_set_id`);--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `rest_ends_at` text;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `last_performance_id` text;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `completed_at` text;
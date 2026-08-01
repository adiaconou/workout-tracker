CREATE TABLE `assistant_exercise_change_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`thread_id` text NOT NULL,
	`action` text NOT NULL,
	`exercise_id` text,
	`exercise_name` text NOT NULL,
	`base_updated_at` text,
	`base_input_json` text,
	`proposed_input_json` text NOT NULL,
	`summary` text NOT NULL,
	`rationale` text NOT NULL,
	`diff_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_exercise_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_exercise_change_plans_owner_status_idx` ON `assistant_exercise_change_plans` (`owner_email`,`status`);--> statement-breakpoint
CREATE INDEX `assistant_exercise_change_plans_thread_created_idx` ON `assistant_exercise_change_plans` (`thread_id`,`created_at`);
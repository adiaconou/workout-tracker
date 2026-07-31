CREATE TABLE `assistant_change_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`thread_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`routine_code` text NOT NULL,
	`base_version_id` text,
	`proposed_input_json` text NOT NULL,
	`summary` text NOT NULL,
	`rationale` text NOT NULL,
	`diff_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_change_plans_owner_status_idx` ON `assistant_change_plans` (`owner_email`,`status`);--> statement-breakpoint
CREATE INDEX `assistant_change_plans_thread_created_idx` ON `assistant_change_plans` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`reasoning_effort` text,
	`response_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_thread_created_idx` ON `assistant_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`title` text DEFAULT 'New coaching conversation' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_threads_owner_updated_idx` ON `assistant_threads` (`owner_email`,`updated_at`);--> statement-breakpoint
CREATE TABLE `assistant_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`thread_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`output_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_tool_calls_thread_created_idx` ON `assistant_tool_calls` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `coach_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`energy` integer NOT NULL,
	`soreness` integer NOT NULL,
	`sleep_quality` integer NOT NULL,
	`available_minutes` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coach_check_ins_owner_created_idx` ON `coach_check_ins` (`owner_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `coach_profiles` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`primary_goal` text DEFAULT 'general fitness' NOT NULL,
	`training_days_per_week` integer DEFAULT 4 NOT NULL,
	`session_duration_min` integer DEFAULT 60 NOT NULL,
	`equipment` text DEFAULT '' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`preferences` text DEFAULT '' NOT NULL,
	`model` text DEFAULT 'gpt-5.6-terra' NOT NULL,
	`reasoning_effort` text DEFAULT 'medium' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

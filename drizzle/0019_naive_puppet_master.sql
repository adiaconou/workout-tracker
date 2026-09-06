ALTER TABLE `assistant_change_plans` ADD `origin_run_id` text;--> statement-breakpoint
ALTER TABLE `assistant_change_plans` ADD `origin_user_message_id` text;--> statement-breakpoint
ALTER TABLE `assistant_change_plans` ADD `applied_as` text;--> statement-breakpoint
ALTER TABLE `assistant_change_plans` ADD `supersedes_plan_id` text;--> statement-breakpoint
ALTER TABLE `assistant_exercise_change_plans` ADD `origin_run_id` text;--> statement-breakpoint
ALTER TABLE `assistant_exercise_change_plans` ADD `origin_user_message_id` text;--> statement-breakpoint
ALTER TABLE `assistant_exercise_change_plans` ADD `applied_as` text;--> statement-breakpoint
ALTER TABLE `assistant_exercise_change_plans` ADD `supersedes_plan_id` text;--> statement-breakpoint
ALTER TABLE `assistant_message_runs` ADD `context_state_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `context_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `time_zone` text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `context_summary_json` text;--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `context_summary_through_message_id` text;--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `context_summary_updated_at` text;
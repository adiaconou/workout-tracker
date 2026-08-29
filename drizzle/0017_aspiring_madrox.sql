CREATE TABLE `assistant_message_run_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`run_id` text NOT NULL,
	`call_id` text NOT NULL,
	`call_signature` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`output_json` text,
	`activity_json` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`error_message` text,
	`lease_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `assistant_message_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_message_run_calls_run_call_idx` ON `assistant_message_run_calls` (`run_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `assistant_message_run_calls_owner_run_idx` ON `assistant_message_run_calls` (`owner_email`,`run_id`);--> statement-breakpoint
CREATE TABLE `assistant_message_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`thread_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text,
	`status` text DEFAULT 'starting' NOT NULL,
	`phase` text DEFAULT 'planning' NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`openai_response_id` text,
	`previous_response_id` text,
	`response_ids_json` text DEFAULT '[]' NOT NULL,
	`pending_input_json` text DEFAULT '[]' NOT NULL,
	`activities_json` text DEFAULT '[]' NOT NULL,
	`call_signatures_json` text DEFAULT '{}' NOT NULL,
	`round_count` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`force_final` integer DEFAULT false NOT NULL,
	`proposal_staged` integer DEFAULT false NOT NULL,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer DEFAULT false NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `assistant_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_message_runs_owner_idempotency_idx` ON `assistant_message_runs` (`owner_email`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_message_runs_assistant_message_idx` ON `assistant_message_runs` (`assistant_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_message_runs_active_thread_idx` ON `assistant_message_runs` (`owner_email`,`thread_id`) WHERE "assistant_message_runs"."status" IN ('starting', 'queued', 'in_progress', 'processing');--> statement-breakpoint
CREATE INDEX `assistant_message_runs_owner_updated_idx` ON `assistant_message_runs` (`owner_email`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assistant_message_runs_expires_idx` ON `assistant_message_runs` (`expires_at`);

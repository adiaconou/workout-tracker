CREATE TABLE `assistant_program_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`openai_response_id` text,
	`status` text DEFAULT 'starting' NOT NULL,
	`request_json` text NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_program_generation_jobs_owner_idempotency_idx` ON `assistant_program_generation_jobs` (`owner_email`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_program_generation_jobs_openai_response_idx` ON `assistant_program_generation_jobs` (`openai_response_id`);--> statement-breakpoint
CREATE INDEX `assistant_program_generation_jobs_owner_updated_idx` ON `assistant_program_generation_jobs` (`owner_email`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assistant_program_generation_jobs_expires_idx` ON `assistant_program_generation_jobs` (`expires_at`);
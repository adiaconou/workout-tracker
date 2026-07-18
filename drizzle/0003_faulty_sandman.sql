CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_owner_email_idx` ON `app_users` (`owner_email`);--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject_idx` ON `auth_identities` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`rotated_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_refresh_hash_idx` ON `auth_sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);
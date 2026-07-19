CREATE TABLE `exercise_favorites` (
	`owner_email` text NOT NULL,
	`exercise_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_email`, `exercise_id`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercise_favorites_exercise_idx` ON `exercise_favorites` (`exercise_id`);
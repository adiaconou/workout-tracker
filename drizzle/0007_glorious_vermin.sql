ALTER TABLE `set_performances` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `set_performances` ADD `elapsed_seconds` integer;--> statement-breakpoint
ALTER TABLE `set_performances` ADD `workout_elapsed_seconds` integer;--> statement-breakpoint
ALTER TABLE `workout_sets` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `workout_sets` ADD `elapsed_seconds` integer;
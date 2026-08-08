ALTER TABLE `app_users` ADD `height_cm` real;--> statement-breakpoint
ALTER TABLE `app_users` ADD `body_weight_kg` real;--> statement-breakpoint
ALTER TABLE `app_users` ADD `measurement_system` text DEFAULT 'imperial' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_sessions` ADD `body_weight_source` text;

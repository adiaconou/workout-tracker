ALTER TABLE `app_users` ADD `equipment_preferences_json` text DEFAULT '["bodyweight","dumbbells","bench","kettlebells","pull_up_station","dip_station","cable_machine","ez_bar","resistance_bands","barbell"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `preferred_workout_duration_min` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `onboarding_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `onboarding_completed_at` text;--> statement-breakpoint
UPDATE `app_users` SET `onboarding_completed_at` = `updated_at`
WHERE `onboarding_version` >= 1 AND `onboarding_completed_at` IS NULL;

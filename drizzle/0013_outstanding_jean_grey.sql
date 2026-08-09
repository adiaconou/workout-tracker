ALTER TABLE `exercise_catalog` ADD `origin` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `exercise_catalog` ADD `template_key` text;--> statement-breakpoint
UPDATE `exercise_catalog`
SET `origin` = 'default',
	`template_key` = 'home-gym:' || substr(`id`, length(`owner_email`) + 13)
WHERE substr(`id`, 1, length(`owner_email`) + 12) = `owner_email` || '::home-gym::'
	AND `origin` = 'custom' AND `template_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_catalog_owner_template_idx` ON `exercise_catalog` (`owner_email`,`template_key`);

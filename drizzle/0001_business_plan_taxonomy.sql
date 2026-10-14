ALTER TABLE `providers` ADD `secondary_categories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `asset_classes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `licences` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `certifications` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `footprint` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `setup_fee` integer;--> statement-breakpoint
ALTER TABLE `providers` ADD `last_verified_at` integer;--> statement-breakpoint
ALTER TABLE `rfi_requests` ADD `request_type` text DEFAULT 'rfi' NOT NULL;--> statement-breakpoint
-- Archive rows still using the pre-taxonomy categories; re-seed or re-import them with a taxonomy slug.
UPDATE `providers` SET `status` = 'archived' WHERE `category` NOT IN ('fund-administration', 'governance-domiciliation', 'regulatory-compliance', 'corporate-accounting', 'tax', 'aifm-manco', 'depositary-banking', 'professional-support');

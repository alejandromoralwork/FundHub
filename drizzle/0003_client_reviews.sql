CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`reviewer_name` text NOT NULL,
	`reviewer_email` text NOT NULL,
	`reviewer_company` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`relationship` text NOT NULL,
	`client_since` integer,
	`fund_structure` text DEFAULT '' NOT NULL,
	`overall` integer NOT NULL,
	`service_quality` integer NOT NULL,
	`responsiveness` integer NOT NULL,
	`pricing_transparency` integer NOT NULL,
	`technology` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`flags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_provider_status_idx` ON `reviews` (`provider_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_provider_email_unique` ON `reviews` (`provider_id`,`reviewer_email`);
CREATE TABLE `providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`provider_type` text NOT NULL,
	`headcount` integer NOT NULL,
	`mandates` integer DEFAULT 0 NOT NULL,
	`tech_stack` text DEFAULT '[]' NOT NULL,
	`top_clients` text DEFAULT '[]' NOT NULL,
	`regulatory_scope` text DEFAULT '[]' NOT NULL,
	`services` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`price_min` integer NOT NULL,
	`price_max` integer NOT NULL,
	`rating` real DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`rcs_number` text,
	`founded_year` integer,
	`headquarters` text DEFAULT 'Luxembourg' NOT NULL,
	`website` text,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);--> statement-breakpoint
CREATE INDEX `providers_status_idx` ON `providers` (`status`);--> statement-breakpoint
CREATE INDEX `providers_category_idx` ON `providers` (`category`);--> statement-breakpoint
CREATE TABLE `rfi_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`company` text NOT NULL,
	`fund_structure` text NOT NULL,
	`aum_band` text NOT NULL,
	`services_needed` text DEFAULT '[]' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rfi_provider_idx` ON `rfi_requests` (`provider_id`);--> statement-breakpoint
CREATE INDEX `rfi_status_idx` ON `rfi_requests` (`status`);
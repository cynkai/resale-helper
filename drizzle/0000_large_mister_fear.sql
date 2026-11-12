CREATE TABLE `cost_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`method` text NOT NULL,
	`sale_amount` integer NOT NULL,
	`basis_price_record_id` integer,
	`fee_mode` text DEFAULT 'AMOUNT' NOT NULL,
	`fee_amount` integer,
	`fee_rate_bp` integer,
	`shipping` integer,
	`packing` integer,
	`transport` integer,
	`expected_minutes` integer,
	`memo` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`basis_price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_item_method_uq` ON `cost_scenarios` (`item_id`,`method`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'OWNED' NOT NULL,
	`name` text NOT NULL,
	`identifier` text,
	`condition` text NOT NULL,
	`defects` text,
	`components` text,
	`memo` text,
	`author` text,
	`publisher` text,
	`edition` text,
	`has_writing` text DEFAULT 'UNKNOWN' NOT NULL,
	`has_underline` text DEFAULT 'UNKNOWN' NOT NULL,
	`has_damage` text DEFAULT 'UNKNOWN' NOT NULL,
	`has_supplement` text DEFAULT 'UNKNOWN' NOT NULL,
	`chosen_method` text,
	`chosen_sale_amount` integer,
	`chosen_net_amount` integer,
	`chosen_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_demo_idx` ON `items` (`is_demo`,`status`);--> statement-breakpoint
CREATE TABLE `lookup_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`key` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lookup_cache_uq` ON `lookup_cache` (`provider`,`key`);--> statement-breakpoint
CREATE TABLE `price_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`price_type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text,
	`normalized_url` text,
	`external_id` text,
	`checked_date` text NOT NULL,
	`trade_date` text,
	`product_identifier` text,
	`condition` text,
	`components` text,
	`bundle_type` text DEFAULT 'SINGLE' NOT NULL,
	`shipping_included` text DEFAULT 'UNKNOWN' NOT NULL,
	`verification_method` text,
	`quote_valid_until` text,
	`deduction_terms` text,
	`input_route` text NOT NULL,
	`memo` text,
	`included_in_comparison` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_item_idx` ON `price_records` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_external_uq` ON `price_records` (`item_id`,`source_name`,`external_id`) WHERE "price_records"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `price_url_uq` ON `price_records` (`item_id`,`normalized_url`) WHERE "price_records"."normalized_url" is not null;--> statement-breakpoint
CREATE TABLE `sale_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`channel` text NOT NULL,
	`sold_date` text NOT NULL,
	`amount` integer NOT NULL,
	`cost_total` integer,
	`minutes_spent` integer,
	`memo` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_results_item_id_unique` ON `sale_results` (`item_id`);
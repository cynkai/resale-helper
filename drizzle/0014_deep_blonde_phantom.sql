CREATE TABLE `cost_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`fee_mode` text DEFAULT 'AMOUNT' NOT NULL,
	`fee_amount` integer,
	`fee_rate_bp` integer,
	`shipping` integer,
	`packing` integer,
	`transport` integer,
	`expected_minutes` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_preset_name_uq` ON `cost_presets` (`is_demo`,`name`);
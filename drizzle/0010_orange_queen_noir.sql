CREATE TABLE `listing_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_template_name_uq` ON `listing_templates` (`is_demo`,`name`);
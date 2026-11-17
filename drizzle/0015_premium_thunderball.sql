CREATE TABLE `import_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (datetime('now')) NOT NULL,
	`endpoint` text NOT NULL,
	`outcome` text NOT NULL,
	`status` integer NOT NULL,
	`route` text,
	`origin` text,
	`item_id` integer,
	`imported` integer,
	`rejected` integer,
	`count` integer DEFAULT 1 NOT NULL
);

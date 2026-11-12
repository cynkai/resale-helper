CREATE TABLE `user_settings` (
	`is_demo` integer PRIMARY KEY NOT NULL,
	`time_value_per_hour` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);

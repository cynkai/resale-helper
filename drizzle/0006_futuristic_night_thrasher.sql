DROP INDEX `scenario_item_method_uq`;--> statement-breakpoint
ALTER TABLE `cost_scenarios` ADD `channel` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cost_scenarios` ADD `is_primary` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_item_method_channel_uq` ON `cost_scenarios` (`item_id`,`method`,`channel`);--> statement-breakpoint
ALTER TABLE `items` ADD `chosen_channel` text;
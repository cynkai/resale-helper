ALTER TABLE `items` ADD `chosen_estimate` text;
--> statement-breakpoint
UPDATE items SET status = 'SOLD'
WHERE status <> 'SOLD' AND EXISTS (SELECT 1 FROM sale_results WHERE sale_results.item_id = items.id);

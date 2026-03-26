CREATE TABLE `competition_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`results_json` text NOT NULL,
	`created_at` text
);
--> statement-breakpoint
ALTER TABLE `users` ADD `active_title` text;
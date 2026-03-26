CREATE TABLE `narrative_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`latest_report_id` integer NOT NULL,
	`narrative` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

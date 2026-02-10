CREATE TABLE `badges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`badge_type` text NOT NULL,
	`badge_label` text NOT NULL,
	`earned_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

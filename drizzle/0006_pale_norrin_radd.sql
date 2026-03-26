CREATE TABLE `streaks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`current_streak` integer DEFAULT 0,
	`best_streak` integer DEFAULT 0,
	`last_measured_at` text,
	`streak_deadline` text,
	`updated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

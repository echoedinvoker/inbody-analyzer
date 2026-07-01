CREATE TABLE `room_streaks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`current_streak` integer DEFAULT 0,
	`best_streak` integer DEFAULT 0,
	`last_measured_at` text,
	`streak_deadline` text,
	`updated_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_streaks_room_id_user_id_unique` ON `room_streaks` (`room_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `streak_interval` integer DEFAULT 21;
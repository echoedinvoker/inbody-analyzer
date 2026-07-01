CREATE TABLE `room_advice_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`latest_submission_id` integer NOT NULL,
	`advice` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_advice_cache_room_id_user_id_unique` ON `room_advice_cache` (`room_id`,`user_id`);
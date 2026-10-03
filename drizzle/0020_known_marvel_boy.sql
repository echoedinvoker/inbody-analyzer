CREATE TABLE `room_reward_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer,
	`forfeit_id` integer,
	`zone_at_mark` text NOT NULL,
	`marked_by` integer NOT NULL,
	`marked_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`forfeit_id`) REFERENCES `room_forfeits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_reward_settlements_room_id_user_id_unique` ON `room_reward_settlements` (`room_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_reward_settlements_room_id_forfeit_id_unique` ON `room_reward_settlements` (`room_id`,`forfeit_id`);
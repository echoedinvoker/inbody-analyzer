CREATE TABLE `room_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member',
	`is_ghost` integer DEFAULT false,
	`joined_at` text DEFAULT '(datetime(''now''))',
	`left_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_members_room_id_user_id_unique` ON `room_members` (`room_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`owner_id` integer NOT NULL,
	`mode` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`measurement_interval` integer DEFAULT 14,
	`max_members` integer DEFAULT 50,
	`invite_code` text NOT NULL,
	`line_group_id` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_slug_unique` ON `rooms` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_invite_code_unique` ON `rooms` (`invite_code`);
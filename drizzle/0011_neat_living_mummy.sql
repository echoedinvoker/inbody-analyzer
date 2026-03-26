CREATE TABLE `room_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`report_id` integer NOT NULL,
	`submitted_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_submissions_room_id_report_id_unique` ON `room_submissions` (`room_id`,`report_id`);--> statement-breakpoint
ALTER TABLE `reports` ADD `is_inbody` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `device_type` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `visibility_mode` text DEFAULT 'open';--> statement-breakpoint
ALTER TABLE `rooms` ADD `min_submissions` integer DEFAULT 3;
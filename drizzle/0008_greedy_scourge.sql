ALTER TABLE `users` ADD `line_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_line_user_id_unique` ON `users` (`line_user_id`);
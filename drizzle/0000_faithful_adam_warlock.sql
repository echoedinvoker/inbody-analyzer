CREATE TABLE `measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`weight` real,
	`skeletal_muscle` real,
	`body_fat_mass` real,
	`body_fat_pct` real,
	`bmi` real,
	`total_body_water` real,
	`visceral_fat_level` integer,
	`basal_metabolic_rate` integer,
	`inbody_score` integer,
	`segmental_lean_json` text,
	`segmental_fat_json` text,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`measured_at` text NOT NULL,
	`photo_path` text,
	`raw_json` text,
	`confirmed` integer DEFAULT false,
	`created_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`invite_code` text,
	`is_admin` integer DEFAULT false,
	`goal` text DEFAULT 'maintain',
	`created_at` text DEFAULT '(datetime(''now''))'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_invite_code_unique` ON `users` (`invite_code`);
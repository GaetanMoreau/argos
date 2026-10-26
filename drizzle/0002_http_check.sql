CREATE TABLE `http_check` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`scan_id` integer,
	`checked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`grade` text,
	`report` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_id`) REFERENCES `scan`(`id`) ON UPDATE no action ON DELETE set null
);

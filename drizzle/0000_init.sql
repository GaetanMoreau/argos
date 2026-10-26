CREATE TABLE `client` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_name_unique` ON `client` (`name`);--> statement-breakpoint
CREATE TABLE `component` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`ecosystem` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`is_dev` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `finding` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`ecosystem` text NOT NULL,
	`component_name` text NOT NULL,
	`version` text NOT NULL,
	`is_dev` integer DEFAULT false NOT NULL,
	`vulnerability_id` text NOT NULL,
	`fixed_in` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vulnerability_id`) REFERENCES `vulnerability`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_key` ON `finding` (`site_id`,`ecosystem`,`component_name`,`vulnerability_id`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`url` text,
	`stack` text,
	`hosting` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_path_unique` ON `site` (`path`);--> statement-breakpoint
CREATE TABLE `vulnerability` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`aliases` text,
	`summary` text,
	`severity` text NOT NULL,
	`cvss` text,
	`is_kev` integer DEFAULT false NOT NULL,
	`url` text
);

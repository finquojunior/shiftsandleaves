ALTER TABLE `requests` ADD `replaces_id` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `over_threshold` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `exception_reason` text;
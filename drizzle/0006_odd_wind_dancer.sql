ALTER TABLE `users` ADD `avatar_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `events_request_idx` ON `events` (`request_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_days_date_idx` ON `request_days` (`date`);--> statement-breakpoint
CREATE INDEX `request_days_request_idx` ON `request_days` (`request_id`);--> statement-breakpoint
CREATE INDEX `requests_user_status_idx` ON `requests` (`user_id`,`status`);--> statement-breakpoint
UPDATE `users` SET `avatar_version` = 1 WHERE `avatar` IS NOT NULL;

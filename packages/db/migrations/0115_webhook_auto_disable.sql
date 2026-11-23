ALTER TABLE "webhook_endpoints" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
-- The app role updates only the columns it is given (0112): the new one joins them, so the worker can switch an address off.
GRANT UPDATE ("disabled_reason") ON "webhook_endpoints" TO absah_app;

CREATE TYPE "public"."card_status" AS ENUM('in_stock', 'issued', 'returned', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."operation_action" AS ENUM('card.created', 'card.issued', 'card.returned', 'card.restocked', 'card.written_off');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'warehouse');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"masked_number" text,
	"status" "card_status" DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"owner_id" uuid,
	"holder_id" uuid,
	"notes" text,
	"issued_at" timestamp with time zone,
	"written_off_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_sku_unique" UNIQUE("sku"),
	CONSTRAINT "cards_issued_requires_holder" CHECK ("cards"."status" <> 'issued' or "cards"."holder_id" is not null),
	CONSTRAINT "cards_written_off_requires_reason" CHECK ("cards"."status" <> 'written_off' or "cards"."written_off_reason" is not null),
	CONSTRAINT "cards_version_non_negative" CHECK ("cards"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_status_check" CHECK ("idempotency_keys"."status" in ('processing', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" "operation_action" NOT NULL,
	"entity_type" text DEFAULT 'card' NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_status" "card_status",
	"to_status" "card_status",
	"details" jsonb,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"warehouse_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login"),
	CONSTRAINT "users_warehouse_scope_check" CHECK (("users"."role" = 'warehouse' and "users"."warehouse_id" is not null) or ("users"."role" <> 'warehouse'))
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_status_idx" ON "cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cards_warehouse_status_idx" ON "cards" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "cards_holder_idx" ON "cards" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "cards_owner_idx" ON "cards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cards_created_at_idx" ON "cards" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_user_endpoint_key_idx" ON "idempotency_keys" USING btree ("user_id","endpoint","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operations_created_at_idx" ON "operations" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operations_entity_idx" ON "operations" USING btree ("entity_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operations_actor_idx" ON "operations" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_processed_at_idx" ON "outbox_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");
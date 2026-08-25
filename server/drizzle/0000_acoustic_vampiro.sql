CREATE TABLE "approval_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"post_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"encrypted_dek" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauth_subject" text NOT NULL,
	"site_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"key" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"tool" text NOT NULL,
	"redacted_args" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_pointer" text,
	"raw_ratio" real,
	"nativeness" real,
	"approval_token_ref" uuid
);
--> statement-breakpoint
CREATE TABLE "preview_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"post_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"generation_default" text,
	"environment" text NOT NULL,
	"plugin_version" text,
	"min_supported_plugin_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_index" ADD CONSTRAINT "ledger_index_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_nonces" ADD CONSTRAINT "preview_nonces_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tokens_token_hash_idx" ON "approval_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "approval_tokens_site_id_idx" ON "approval_tokens" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "credentials_site_id_idx" ON "credentials" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_subject_site_idx" ON "grants" USING btree ("oauth_subject","site_id");--> statement-breakpoint
CREATE INDEX "grants_site_id_idx" ON "grants" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_subject_site_key_idx" ON "idempotency_keys" USING btree ("subject","site_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_site_id_idx" ON "idempotency_keys" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ledger_index_site_id_idx" ON "ledger_index" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ledger_index_correlation_id_idx" ON "ledger_index" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_nonces_token_hash_idx" ON "preview_nonces" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "preview_nonces_site_id_idx" ON "preview_nonces" USING btree ("site_id");
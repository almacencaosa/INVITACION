CREATE TABLE "votes" (
	"voter_id" text PRIMARY KEY,
	"team" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_team_check" CHECK ("team" in ('boy', 'girl'))
);

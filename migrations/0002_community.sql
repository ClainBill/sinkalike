-- Comments, likes and poll votes.
-- thread / poll keys look like "episode:1-speed-racer" or "movie:speed-racer".

create table "comment" (
  "id" text not null primary key,
  "thread" text not null,
  "parentId" text references "comment" ("id") on delete cascade,
  "userId" text references "user" ("id") on delete cascade,
  "anonName" text,
  -- "u:<userId>" or "a:<device id>", so anonymous commenters can delete their own comments.
  "voter" text not null,
  "body" text not null,
  "status" text not null default 'visible' check ("status" in ('visible', 'pending', 'hidden')),
  "ipHash" text,
  "createdAt" integer not null,
  "editedAt" integer
);

create index "comment_thread_idx" on "comment" ("thread", "status", "createdAt");
create index "comment_status_idx" on "comment" ("status", "createdAt");
create index "comment_ip_idx" on "comment" ("ipHash", "createdAt");

-- voter is "u:<userId>" for accounts or "a:<random device id>" for anonymous visitors.
create table "commentLike" (
  "commentId" text not null references "comment" ("id") on delete cascade,
  "voter" text not null,
  "createdAt" integer not null,
  primary key ("commentId", "voter")
);

create table "pollVote" (
  "poll" text not null,
  "voter" text not null,
  "option" integer not null,
  "ipHash" text,
  "createdAt" integer not null,
  primary key ("poll", "voter")
);

create index "pollVote_ip_idx" on "pollVote" ("poll", "ipHash");

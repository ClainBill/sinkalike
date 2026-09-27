-- Movies a host has taken off the movie list from the website.
create table "hiddenMovie" (
  "slug" text not null primary key,
  "hiddenBy" text references "user" ("id") on delete set null,
  "createdAt" integer not null
);

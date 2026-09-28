create table invoice_searches (
  id bigserial primary key,
  term varchar(100) not null,
  searched_at timestamptz not null default now()
);

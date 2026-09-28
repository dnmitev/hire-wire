create table discount_codes (
  code text primary key,
  percent_off numeric not null check (percent_off > 0 and percent_off <= 100),
  max_redemptions int not null,
  redemptions int not null default 0,
  active boolean not null default true
);

alter table invoices
  add column notes text,
  add column discount_code text,
  add column discount_cents bigint not null default 0;

insert into discount_codes (code, percent_off, max_redemptions) values ('WELCOME10', 10, 100);

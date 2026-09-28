create table invoices (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_email text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  total_cents bigint not null check (total_cents >= 0),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'paid', 'payment_failed')),
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoices_status_created_at_idx on invoices (status, created_at desc);

create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  position int not null,
  description text not null,
  quantity int not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  unique (invoice_id, position)
);

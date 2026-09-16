# Visitor Tracking Setup

Your site now includes a visitor analytics section with:

- Total page views (via CounterAPI, works immediately)
- World map with visitor locations
- Recent visitor list with city and country

To save every visitor's location permanently (not just the current browser), connect a free Supabase project.

## 1. Create Supabase project

1. Go to [https://supabase.com](https://supabase.com) and create a free account.
2. Create a new project.
3. Open **SQL Editor** and run:

```sql
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  country text,
  city text,
  region text,
  lat double precision,
  lng double precision
);

create index if not exists visits_created_at_idx
on public.visits (created_at desc);

create index if not exists visits_country_idx
on public.visits (country);

alter table public.visits enable row level security;

create policy "Allow anonymous read"
on public.visits
for select
to anon
using (true);

create policy "Allow anonymous insert"
on public.visits
for insert
to anon
with check (true);

create or replace function public.visitor_country_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(distinct country)
  from public.visits
  where country is not null and btrim(country) <> '';
$$;

grant execute on function public.visitor_country_count() to anon;
```

## 2. Add credentials to the site

1. In Supabase, open **Project Settings -> API**.
2. Copy:
   - Project URL
   - `anon` public key
3. Paste them into `js/supabase-config.js`:

```js
window.VISITOR_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_KEY",
};
```

## 3. Deploy

Commit and push to GitHub. GitHub Pages will update automatically.

## What visitors can see

- The site only stores approximate city/region/country, rounded latitude/longitude, and visit time from the visitor's public IP lookup.
- It does not store the visitor's IP address.
- The Supabase `anon` key is public by design. It is safe here because Row Level Security limits anonymous users to reading and inserting visitor rows.
- Do not paste your Supabase `service_role` key into the website.

## Troubleshooting

- If page views show `Offline`, CounterAPI may be temporarily unreachable. The rest of the site will keep working.
- If the map loads but no pin appears, the IP lookup may not have returned a usable latitude/longitude.
- If Supabase is configured but no historical visitors appear, confirm the SQL policies were created and that `js/supabase-config.js` uses the Project URL and `anon` public key.
- If GitHub Pages does not update right away, wait a minute and refresh with a hard reload.

## Notes

- Location is estimated from IP address via [ipapi.co](https://ipapi.co).
- Each browser logs one location visit per session to avoid duplicate map/list entries.
- Page views increment on each page load.

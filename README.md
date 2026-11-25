# Cloudflare DNS sync

A Node.js cron-friendly script that reads its Cloudflare API token and configured DNS A records from Supabase. It looks up the host's public IPv4 address and updates each Cloudflare record only when its content differs.

## Setup

1. In Supabase, run [`supabase/schema.sql`](supabase/schema.sql).
2. Insert the Cloudflare token and records. Use a Cloudflare API token scoped to the needed zones with **Zone / DNS / Edit** and **Zone / Zone / Read** permissions.

   ```sql
   insert into vx_admin.cloudflare_config (api_token)
   values ('YOUR_CLOUDFLARE_API_TOKEN');

   insert into vx_admin.dns_records (zone_id, record_name, proxied, ttl)
   values
     ('YOUR_CLOUDFLARE_ZONE_ID', 'home.example.com', false, 1);
   ```

   Add one row per hostname. `cloudflare_record_id` is optional; if omitted, the script locates the A record by its exact name and type.
3. On the machine that will run the cron job, install Node.js 20 or newer and configure the project:

   ```sh
   yarn install
   cp .env.example .env
   # Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
   ```

   Protect `.env` as a secret. The Supabase service role key bypasses row-level security; it must only be used by this trusted script and must never be committed or exposed in a client application.
4. Run once manually to confirm connectivity. The script loads variables from `.env`:

   ```sh
   yarn sync
   ```

   To preview changes without updating Cloudflare, run `yarn sync --dry-run`.

## Cron

For example, to check every five minutes, add a crontab entry (replace the paths with the actual install location):

```cron
*/5 * * * * cd /path/to/cf_dns_sync && /usr/bin/yarn sync >> /var/log/cf-dns-sync.log 2>&1
```

The job exits nonzero on lookup, Supabase, or Cloudflare errors so the failure is visible in the cron log. Avoid overlapping runs if the job may take longer than its interval.

## Notes

- Only A records are supported; this is intended for a host with a public IPv4 address.
- Store `zone_id` from the Cloudflare dashboard. The API token itself stays in Supabase, while the Supabase URL and service role key stay in the cron host's environment.
- The token is stored as database text. Restrict Supabase project and database access accordingly, and rotate the token if it is exposed.

import { createClient } from '@supabase/supabase-js';
import { isIPv4 } from 'node:net';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicIpUrl = process.env.PUBLIC_IP_URL ?? 'https://api.ipify.org';
const dryRun = process.argv.includes('--dry-run');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'vx_admin' },
});

async function getPublicIpv4() {
  const response = await fetch(publicIpUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Public IP lookup failed (${response.status})`);
  const ip = (await response.text()).trim();
  if (!isIPv4(ip)) throw new Error(`Public IP service returned an invalid IPv4 address: ${ip}`);
  return ip;
}

async function cloudflareRequest(token, path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const messages = (body.errors ?? []).map((error) => error.message).join('; ');
    throw new Error(`Cloudflare API error (${response.status})${messages ? `: ${messages}` : ''}`);
  }
  return body.result;
}

async function main() {
  if (dryRun) console.log('Dry run enabled: Cloudflare DNS records will not be changed.');

  const [{ data: config, error: configError }, { data: records, error: recordsError }] = await Promise.all([
    supabase.from('cloudflare_config').select('api_token').limit(1).single(),
    supabase.from('dns_records').select('id, zone_id, record_name, record_type, proxied, ttl, cloudflare_record_id').eq('enabled', true),
  ]);

  if (configError) throw new Error(`Could not load Cloudflare configuration: ${configError.message}`);
  if (recordsError) throw new Error(`Could not load DNS records: ${recordsError.message}`);
  if (!config?.api_token) throw new Error('Cloudflare API token is missing from cloudflare_config');
  if (!records?.length) {
    console.log('No enabled DNS records configured.');
    return;
  }

  const publicIp = await getPublicIpv4();
  console.log(`Current public IPv4: ${publicIp}`);

  for (const record of records) {
    if (record.record_type !== 'A') {
      console.warn(`Skipping ${record.record_name}: only A records are supported.`);
      continue;
    }

    const query = new URLSearchParams({ name: record.record_name, type: 'A', per_page: '100' });
    const found = await cloudflareRequest(config.api_token, `/zones/${encodeURIComponent(record.zone_id)}/dns_records?${query}`);
    const cloudflareRecord = record.cloudflare_record_id
      ? found.find((item) => item.id === record.cloudflare_record_id)
      : found.find((item) => item.name === record.record_name && item.type === 'A');

    if (!cloudflareRecord) {
      throw new Error(`Cloudflare A record not found for ${record.record_name} (zone ${record.zone_id})`);
    }
    if (cloudflareRecord.content === publicIp) {
      console.log(`${record.record_name} is already ${publicIp}`);
      continue;
    }

    if (dryRun) {
      console.log(`Would update ${record.record_name}: ${cloudflareRecord.content} → ${publicIp}`);
      continue;
    }

    await cloudflareRequest(
      config.api_token,
      `/zones/${encodeURIComponent(record.zone_id)}/dns_records/${encodeURIComponent(cloudflareRecord.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          type: 'A',
          name: record.record_name,
          content: publicIp,
          ttl: record.ttl ?? 1,
          proxied: record.proxied ?? false,
        }),
      },
    );
    console.log(`Updated ${record.record_name}: ${cloudflareRecord.content} → ${publicIp}`);
  }
}

main().catch((error) => {
  console.error(`DNS sync failed: ${error.message}`);
  process.exitCode = 1;
});

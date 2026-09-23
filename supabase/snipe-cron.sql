-- Runs the snipe task every 15 minutes, 06:00–23:00 Oslo time, from Supabase.
-- Vercel's Hobby plan only allows daily crons, so the frequent run lives here.
--
-- 1. Database → Extensions: enable pg_cron and pg_net.
-- 2. Replace the URL and <CRON_SECRET>, then run this in the SQL editor.
--
-- ?async=1 makes the endpoint answer 202 at once and keep working in the
-- background, so pg_net's short timeout doesn't matter.

select cron.schedule(
  'jobba-snipe',
  '*/15 4-21 * * *', -- UTC; covers 06–23 in summer, 05–22 in winter
  $$
  select net.http_get(
    url := 'https://your-app.example.com/api/cron/snipe?async=1',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 5000
  );
  $$
);

-- Check it:   select * from cron.job_run_details order by start_time desc limit 10;
-- Remove it:  select cron.unschedule('jobba-snipe');

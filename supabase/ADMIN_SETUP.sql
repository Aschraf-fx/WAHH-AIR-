-- Run this AFTER you register your own account from the WAHH AIR web app.
-- Replace the email below with your own Admin login email.

update public.profiles p
set role='admin', public_id='WA-000001'
from auth.users u
where p.id=u.id and u.email='YOUR_ADMIN_EMAIL';

update public.stock_locations sl
set location_code='WA-000001', name='WAHH AIR Admin', active=false
from public.profiles p
where sl.user_id=p.id and p.public_id='WA-000001';

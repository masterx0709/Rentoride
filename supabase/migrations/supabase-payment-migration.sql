-- Run this once in the Supabase SQL editor before deploying the payment flow.

alter table bookings add column if not exists amount_paid numeric default 0;
alter table bookings add column if not exists payment_status text default 'pending'; -- pending | paid | failed
alter table bookings add column if not exists razorpay_order_id text;
alter table bookings add column if not exists razorpay_payment_id text;

-- Bookings.status also gains one new value used before payment completes:
-- 'pending_payment' — set on insert, then flipped to 'upcoming' once paid.

-- Backfill: bookings made before payments existed are treated as settled
-- so they don't suddenly show as "awaiting payment" in the dashboards.
update bookings set payment_status = 'paid', amount_paid = total_amount where payment_status = 'pending';

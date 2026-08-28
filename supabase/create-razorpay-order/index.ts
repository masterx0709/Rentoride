// Supabase Edge Function: create-razorpay-order
//
// Creates a Razorpay order for a booking and stores the order id on the
// booking row. Runs server-side so RAZORPAY_KEY_SECRET is never exposed
// to the browser.
//
// Deploy:   supabase functions deploy create-razorpay-order
// Secrets:  supabase secrets set RAZORPAY_KEY_ID=xxx RAZORPAY_KEY_SECRET=xxx
//
// Call from the client with supabaseClient.functions.invoke(...) — that
// automatically forwards the caller's auth token, which is how this
// function knows who's asking and enforces they own the booking.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!;
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ---- Single place that decides what a booking actually charges ----
// Change PAYMENT_MODE here (not on the client) when you're ready to
// switch from full payment to a deposit or a small booking fee.
const PAYMENT_MODE: 'full' | 'deposit' | 'fee' = 'full';
const DEPOSIT_FLAT_RUPEES = 1000;
const BOOKING_FEE_FLAT_RUPEES = 200;

function amountToChargeRupees(totalAmount: number): number {
  if (PAYMENT_MODE === 'deposit') return Math.min(DEPOSIT_FLAT_RUPEES, totalAmount);
  if (PAYMENT_MODE === 'fee') return Math.min(BOOKING_FEE_FLAT_RUPEES, totalAmount);
  return totalAmount;
}
// ---------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing auth header');

    // Client bound to the caller's own JWT — used only to confirm who they are.
    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) throw new Error('Not authenticated');

    const { booking_id } = await req.json();
    if (!booking_id) throw new Error('booking_id is required');

    // Service-role client — bypasses RLS so we can read/update the booking
    // after independently confirming (above) that the caller owns it.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, customer_id, total_amount, payment_status')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) throw new Error('Booking not found');
    if (booking.customer_id !== user.id) throw new Error('This booking does not belong to you');
    if (booking.payment_status === 'paid') throw new Error('This booking is already paid');

    const amountPaise = Math.round(amountToChargeRupees(Number(booking.total_amount)) * 100);
    if (!amountPaise || amountPaise < 100) throw new Error('Invalid amount for payment');

    // Razorpay Orders API — Basic Auth with key_id:key_secret.
    const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`),
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: booking_id,
        notes: { booking_id, customer_id: user.id },
      }),
    });

    const order = await rpRes.json();
    if (!rpRes.ok) throw new Error(order?.error?.description || 'Razorpay order creation failed');

    await admin.from('bookings').update({ razorpay_order_id: order.id }).eq('id', booking_id);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: RAZORPAY_KEY_ID,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

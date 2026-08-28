// Supabase Edge Function: verify-razorpay-payment
//
// Verifies the HMAC signature Razorpay returns after checkout, so a
// booking can only be marked "paid" by a genuinely completed payment —
// never by the browser just claiming success.
//
// Deploy:   supabase functions deploy verify-razorpay-payment
// Secrets:  reuses RAZORPAY_KEY_SECRET set for create-razorpay-order

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Must match create-razorpay-order's config exactly, so the amount
// recorded as paid matches what was actually charged.
const PAYMENT_MODE: 'full' | 'deposit' | 'fee' = 'full';
const DEPOSIT_FLAT_RUPEES = 1000;
const BOOKING_FEE_FLAT_RUPEES = 200;

function amountToChargeRupees(totalAmount: number): number {
  if (PAYMENT_MODE === 'deposit') return Math.min(DEPOSIT_FLAT_RUPEES, totalAmount);
  if (PAYMENT_MODE === 'fee') return Math.min(BOOKING_FEE_FLAT_RUPEES, totalAmount);
  return totalAmount;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing auth header');

    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) throw new Error('Not authenticated');

    const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error('Missing payment details');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, customer_id, razorpay_order_id, total_amount, status')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) throw new Error('Booking not found');
    if (booking.customer_id !== user.id) throw new Error('This booking does not belong to you');
    if (booking.razorpay_order_id !== razorpay_order_id) throw new Error('Order mismatch');

    const expectedSignature = await hmacHex(RAZORPAY_KEY_SECRET, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (expectedSignature !== razorpay_signature) {
      await admin.from('bookings').update({ payment_status: 'failed' }).eq('id', booking_id);
      throw new Error('Payment signature verification failed');
    }

    const chargedAmount = amountToChargeRupees(Number(booking.total_amount));

    await admin
      .from('bookings')
      .update({
        payment_status: 'paid',
        razorpay_payment_id,
        amount_paid: chargedAmount,
        status: 'upcoming',
      })
      .eq('id', booking_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

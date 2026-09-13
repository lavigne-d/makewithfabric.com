/* ------------------------------------------------------------------
   Waitlist signup. The page POSTs { email } here; this Worker adds the
   address to Buttondown through its API, which sends the double opt-in
   confirmation email. Unlike the embed form, the API never shows a
   CAPTCHA, and we get a real answer back, so the page only says "Check
   your inbox" when the email actually went out.

   Secrets (set with `npx wrangler secret put BUTTONDOWN_API_KEY`):
     BUTTONDOWN_API_KEY  Buttondown → Settings → API
   ------------------------------------------------------------------ */

const ALLOWED_ORIGINS = [
  'https://www.makewithfabric.com',
  'https://makewithfabric.com',
  'http://localhost:8000', // local testing: python -m http.server
];

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' });

    let data;
    try { data = await request.json(); } catch { return reply(400, { ok: false, error: 'Bad request.' }); }

    if (data.company) return reply(200, { ok: true });   // honeypot: pretend it worked
    const email = String(data.email || '').trim();
    if (!EMAIL.test(email)) return reply(422, { ok: false, error: 'That address looks incomplete.' });

    let res, body;
    try {
      res = await fetch('https://api.buttondown.com/v1/subscribers', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${String(env.BUTTONDOWN_API_KEY || '').trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: email,
          // no tags: on plans without tag support Buttondown rejects them (403)
          ip_address: request.headers.get('CF-Connecting-IP') || undefined,
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      console.error('buttondown unreachable', err);
      return reply(502, { ok: false, error: 'Something went wrong. Try again in a moment.' });
    }

    if (res.ok) return reply(200, { ok: true });

    const detail = `${body.code || ''} ${body.detail || ''}`.toLowerCase();
    if (detail.includes('already')) return reply(200, { ok: true, already: true });
    if (res.status === 400 && detail.includes('email')) {
      return reply(422, { ok: false, error: "That email address can't receive mail. Check it and try again." });
    }

    console.error('buttondown error', res.status, JSON.stringify(body));
    return reply(502, { ok: false, error: 'Something went wrong. Try again in a moment.' });
  },
};

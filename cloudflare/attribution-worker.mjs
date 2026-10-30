const HOSTS = new Set(['puul.ai', 'www.puul.ai']);
const SOURCES = new Set(['direct_unknown', 'other_referral', 'self', 'google', 'google_app', 'bing', 'duckduckgo', 'yahoo', 'baidu', 'yandex', 'x', 'linkedin', 'github', 'hacker_news', 'reddit', 'rtldatasets']);
const CAMPAIGN_SOURCES = new Set(['', 'google', 'bing', 'duckduckgo', 'x', 'linkedin', 'github', 'hacker_news', 'reddit', 'newsletter', 'email', 'partner']);
const MEDIA = new Set(['', 'organic', 'social', 'email', 'referral', 'cpc']);
const CAMPAIGNS = new Set(['', 'data_request', 'verification']);
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const FIELDS = ['event', 'source', 'utm_source', 'utm_medium', 'utm_campaign'];
let minute = 0;
let requests = 0;
const response = status => new Response(null, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.pathname !== '/api/attribution' || url.search) return response(404);
    if (request.method !== 'POST') return response(405);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') !== 'same-origin') return response(403);
    if (request.headers.get('Content-Type') !== 'application/json') return response(415);
    // Preserve the site's EU exclusion. Unknown geography is excluded as well.
    const country = request.cf?.country;
    if (!country || country === 'XX' || country === 'T1' || request.cf?.isEUCountry === '1' || EU.has(country)) return response(204);
    if (request.headers.get('Sec-GPC') === '1' || request.headers.get('DNT') === '1') return response(204);
    if (request.cf?.botManagement?.verifiedBot || (request.cf?.botManagement?.score != null && request.cf.botManagement.score < 30)) return response(204);
    // Aggregate throttle, not a visitor/IP-based limiter. Best effort per isolate.
    const currentMinute = Math.floor(Date.now() / 60000);
    if (currentMinute !== minute) { minute = currentMinute; requests = 0; }
    if (++requests > 120) return response(429);
    const declared = request.headers.get('Content-Length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 512)) return response(413);
    let data;
    try {
      if (!request.body) return response(400);
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512) { await reader.cancel(); return response(413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (_) { return response(400); }
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== FIELDS.length || FIELDS.some(key => typeof data[key] !== 'string') || Object.keys(data).some(key => !FIELDS.includes(key))) return response(400);
    if (!['landing', 'email_click'].includes(data.event) || !SOURCES.has(data.source) || !CAMPAIGN_SOURCES.has(data.utm_source) || !MEDIA.has(data.utm_medium) || !CAMPAIGNS.has(data.utm_campaign)) return response(400);
    const day = new Date().toISOString().slice(0, 10);
    const test = data.utm_campaign === 'verification' ? 1 : 0;
    try {
      // One atomic aggregate update; no individual event table or raw request logs.
      await env.DB.prepare(`INSERT INTO daily_counts
        (day, event, source, utm_source, utm_medium, utm_campaign, is_test, count)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1
        WHERE (SELECT COALESCE(SUM(count), 0) FROM daily_counts WHERE day = ?) < 5000
        ON CONFLICT (day, event, source, utm_source, utm_medium, utm_campaign, is_test)
        DO UPDATE SET count = count + 1`)
        .bind(day, data.event, data.source, data.utm_source, data.utm_medium, data.utm_campaign, test, day).run();
      return response(204);
    } catch (_) { return response(503); }
  }
};

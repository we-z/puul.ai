(() => {
  'use strict';
  if (!['puul.ai', 'www.puul.ai'].includes(location.hostname)) return;
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;

  const allow = (value, values) => values.includes(value) ? value : '';
  const query = new URLSearchParams(location.search);
  const campaigns = ['data_request', 'verification'];
  const campaignSources = ['google', 'bing', 'duckduckgo', 'x', 'linkedin', 'github', 'hacker_news', 'reddit', 'newsletter', 'email', 'partner'];
  const media = ['organic', 'social', 'email', 'referral', 'cpc'];
  let source = 'direct_unknown';
  if (document.referrer) {
    source = 'other_referral';
    try {
      const ref = new URL(document.referrer);
      const host = ref.hostname.toLowerCase().replace(/^www\./, '');
      const categories = {
        'google.com': 'google',
        'com.google.android.googlequicksearchbox': 'google_app',
        'bing.com': 'bing', 'duckduckgo.com': 'duckduckgo',
        'search.yahoo.com': 'yahoo', 'baidu.com': 'baidu', 'yandex.com': 'yandex',
        't.co': 'x', 'x.com': 'x', 'twitter.com': 'x',
        'linkedin.com': 'linkedin', 'lnkd.in': 'linkedin', 'github.com': 'github',
        'news.ycombinator.com': 'hacker_news', 'reddit.com': 'reddit',
        'rtldatasets.com': 'rtldatasets', 'puul.ai': 'self'
      };
      source = categories[host] || 'other_referral';
    } catch (_) { /* Never send an unparsed referrer. */ }
  }
  const attribution = {
    source,
    utm_source: allow(query.get('utm_source'), campaignSources),
    utm_medium: allow(query.get('utm_medium'), media),
    utm_campaign: allow(query.get('utm_campaign'), campaigns)
  };
  const sent = new Set();
  function record(event) {
    if (sent.has(event)) return;
    sent.add(event);
    // No cookies, storage, identifiers, URL strings, or automatic retries.
    fetch('/api/attribution', {
      method: 'POST', mode: 'same-origin', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...attribution }),
      keepalive: true, cache: 'no-store', referrerPolicy: 'origin'
    }).catch(() => {});
  }
  record('landing');
  document.querySelector('a.sample-request')?.addEventListener('click', event => {
    if (event.isTrusted) record('email_click');
    // Do not prevent, delay, or change the original mailto action.
  });
})();

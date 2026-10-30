SELECT day, source, utm_source, utm_medium, utm_campaign,
  SUM(CASE WHEN event = 'landing' THEN count ELSE 0 END) AS landings,
  SUM(CASE WHEN event = 'email_click' THEN count ELSE 0 END) AS email_clicks
FROM daily_counts
WHERE is_test = 0 AND day >= date('now', '-29 days')
GROUP BY day, source, utm_source, utm_medium, utm_campaign
ORDER BY day DESC, landings DESC, email_clicks DESC;

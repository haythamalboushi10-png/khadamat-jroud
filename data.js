/* إعدادات تقنية ثابتة فقط. عدّل SHEET_ID واسم النطاق بعد إنشاء Google Sheet. */
window.APP_CONFIG = Object.freeze({
  SHEET_ID: "1krzmE9lWFuVInmj-BOKs7O9dz_sj4v0JNiLe8ZglP3A",
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,
  CACHE_KEY: "jeroud-services-data-v1",
  USER_KEY: "jeroud-services-user-v1",
  VISIT_KEY: "jeroud-services-visit-v1",
  MAX_CACHE_AGE_MS: 30 * 24 * 60 * 60 * 1000,
  FETCH_TIMEOUT_MS: 12000,
  TIME_ZONE: "Asia/Damascus",
  DATA_TABS: ["Settings", "Water", "Pharmacies", "Emergency", "Ads", "Neighborhoods"]
});

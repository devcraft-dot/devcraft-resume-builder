/** Must stay in sync with `host_permissions` in manifest.json (MV3 requires it for background fetch). */
const API_URL = "https://devcraft-resume-builder.vercel.app";

const DELAYS = {
  /** After SERP page changes (pagination): mosaic needs time to hydrate */
  AFTER_PAGE_LOAD: 4500,
  /** Max wait for tab URL to change after next-page action */
  SERP_PAGINATION_URL_WAIT_MS: 28000,
  AFTER_CLICK_JOB: 2800,
  BETWEEN_JOBS: 1500,
  DETAIL_TAB_SETTLE: 2500,
  APPLY_TAB_SETTLE: 3500,
  APPLY_BFF_POLL: 900,
  APPLY_NEW_TAB_POLL: 200,
  APPLY_CLICK_NEW_TAB_WAIT: 9000,
  /** Indeed bot / interstitial: poll until clear or cap */
  BOT_CHECK_MAX_WAIT_MS: 30000,
  BOT_CHECK_POLL_MS: 1000,
};

/**
 * THE ONLY FILE YOU EDIT TO DEPLOY.
 *
 * Fill in the two values from Supabase → Project Settings → API.
 * Both are safe to publish: Row Level Security protects the data, not this key.
 *
 * NEVER put the service_role key or the Gemini key in this file, or anywhere
 * else under app/. They live only in Supabase Edge Function secrets.
 */

/**
 * Demo mode — run the apps with no Supabase project at all.
 *
 * Opening the page as  http://localhost:5173/?demo  points it at the mock
 * server in tools/mock_supabase.py instead. The flag is remembered for the
 * tab, so moving between the worker and owner apps keeps it.
 *
 * Gated on localhost, so it can never switch on for a deployed build no
 * matter what anyone puts in the URL.
 */
const DEMO = (() => {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!local) return false;
  if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem('demo', '1');
  return sessionStorage.getItem('demo') === '1';
})();

export const CONFIG = {
  SUPABASE_URL: DEMO ? 'http://localhost:5174' : 'https://lxcupaosxgpcgtgoaspr.supabase.co',
  SUPABASE_ANON_KEY: DEMO ? 'demo-anon-key' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4Y3VwYW9zeGdwY2d0Z29hc3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNjQzNjUsImV4cCI6MjEwMTk0MDM2NX0.NcBsT6-czrj6ZiwffCkqN12580BagZzyN9XAn9A-hvg',
  DEMO,

  /** Accounts created in Section 5.3 of the build guide. Nothing is ever mailed here. */
  OWNER_EMAIL: 'owner@shop.local',
  WORKER_EMAIL: 'worker@shop.local',

  /**
   * The business day: midnight to midnight in this zone (the client's
   * decision, DEVIATIONS.md #9). The server's clock decides a live send; the
   * phone's clock only labels the screen and a photo parked offline.
   */
  TIMEZONE: 'Asia/Riyadh',

  /** Private storage bucket holding the notebook photographs. */
  BUCKET: 'receipts',

  PHOTO: {
    /** Long edge in pixels after compression. Guide 9.4. */
    MAX_EDGE: 1600,
    /** JPEG quality. 1600px @ 0.7 lands around 200–300 KB. */
    QUALITY: 0.7,
    /** Hard ceiling — a photo above this is refused rather than sent. */
    MAX_BYTES: 1024 * 1024,
  },

  BULK_IMPORT: {
    /** Photos uploaded per batch before pausing. Guide 9.9. */
    BATCH_SIZE: 5,
    /**
     * Pause between batches, ms. [4.2] 5 photos per 40 s ≈ 7.5 a minute —
     * under the free tier's per-minute limit with room for the worker's own
     * daily photo (DEVIATIONS.md #22).
     */
    BATCH_DELAY_MS: 40000,
    /**
     * [4.2] The free tier also caps requests per DAY. Photos past this many
     * in one import would only come back "reading failed", so the importer
     * stops here and the owner continues the next day. Check the real figure
     * for the chosen model in Google AI Studio → Rate limits, and set it here.
     */
    DAILY_CAP: 200,
  },

  /** [4.2] A send that has not finished after this long is parked for later. */
  SEND_TIMEOUT_MS: 45000,

  /** [4.2] A reading still pending after this long gets a "read again" button. */
  STUCK_READING_MS: 3 * 60 * 1000,

  /** Seconds a signed photo URL stays valid. Guide 9.8. */
  SIGNED_URL_TTL: 600,

  /** Extraction confidence at or below this is flagged on the review card. Guide 4.5. */
  LOW_CONFIDENCE: 0.8,

  /** Max photos the worker app may hold offline before it refuses more. */
  OFFLINE_QUEUE_LIMIT: 3,
};

/**
 * Gap tests for C1: detectBotChallenge false-positives.
 *
 * Before the fix these three legitimate pages are incorrectly flagged as bot challenges
 * because "just a moment", "ray id", and "datadome" are bare substring matched.
 *
 * After the fix:
 *   - false-positive pages → false
 *   - genuine CF interstitial structures → true
 */
import { describe, it, expect } from "vitest";
import { detectBotChallenge } from "../../src/utils/http.js";

// ---------------------------------------------------------------------------
// FALSE-POSITIVE repros (must return false)
// ---------------------------------------------------------------------------

describe("C1 detectBotChallenge false-positive prevention", () => {
  it('FP-1: "just a moment" in blog prose does NOT trigger', () => {
    // A rich article page that contains the phrase in body text only
    const html = `
      <html>
        <head><title>10 Things About Patience - A Blog Post</title></head>
        <body>
          <article>
            <h1>Learning to wait</h1>
            <p>Just a moment of stillness can transform how you experience the world.
            Many philosophers have argued that in just a moment of silence, clarity emerges.
            This article explores how patience changes our perception.</p>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
            exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure
            dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
            Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
            mollit anim id est laborum.</p>
            <p>More content follows with lots of text to ensure body text length passes the
            heuristic threshold for normal content pages that we need to verify.</p>
          </article>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(false);
  });

  it('FP-2: "Ray ID" in a Cloudflare documentation / article page does NOT trigger', () => {
    // A documentation page about what a Cloudflare Ray ID is
    const html = `
      <html>
        <head><title>What is a Cloudflare Ray ID? - Documentation</title></head>
        <body>
          <nav><ul><li>Home</li><li>Documentation</li><li>Troubleshooting</li></ul></nav>
          <main>
            <h1>Understanding the Cloudflare Ray ID</h1>
            <p>A Ray ID is a unique identifier assigned to every request that passes through
            the Cloudflare network. When you see a Ray ID in an error message, it helps
            Cloudflare support trace the exact request that caused the issue.</p>
            <p>For example, you might see something like: Ray ID: 7f3a8c912d04e001</p>
            <p>The Ray ID format encodes information about the Cloudflare data center, the
            time the request was processed, and a unique identifier for the request itself.
            This makes it extremely useful for debugging connectivity issues.</p>
            <p>If you encounter an error page showing a Ray ID, copy the entire identifier
            and include it when contacting Cloudflare support or your hosting provider.</p>
            <footer><p>Documentation - Last updated 2024-01-15</p></footer>
          </main>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(false);
  });

  it('FP-3: "datadome" only in script src on a real, unblocked page does NOT trigger', () => {
    // A real product page that happens to load the DataDome client SDK
    // (this is what an already-unblocked/allowed page looks like — the SDK is loaded
    //  for passive tracking/scoring, NOT a challenge interstitial)
    const html = `
      <html>
        <head>
          <title>Premium Running Shoes - SportStore</title>
          <script src="https://js.datadome.co/tags.js" async></script>
        </head>
        <body>
          <header><nav><ul><li>Home</li><li>Shop</li><li>Cart</li></ul></nav></header>
          <main>
            <h1>Nike Air Max 270</h1>
            <p>The Nike Air Max 270 features Nike's biggest heel Air unit yet for an extremely
            plush, comfortable ride. The design draws inspiration from Air Max icons, blending
            heritage and innovative technology for an everyday look that pairs with any outfit.</p>
            <p>Price: $150.00</p>
            <p>Available in sizes: 7, 8, 9, 10, 11, 12</p>
            <p>Color options: Black/White, Grey/Orange, Navy/Red</p>
            <p>Free shipping on orders over $75. Easy 30-day returns.</p>
            <div class="reviews">
              <p>Customer review: "Great shoes, very comfortable for long walks and casual wear."</p>
              <p>Customer review: "Perfect fit, true to size. Highly recommend!"</p>
            </div>
          </main>
          <footer><p>© 2024 SportStore</p></footer>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // GENUINE INTERSTITIALS (must still return true — do not regress)
  // ---------------------------------------------------------------------------

  it('GENUINE-1: Real Cloudflare interstitial with <title>Just a moment...</title> and CF challenge div is still caught', () => {
    // Typical CF "Checking your browser before accessing" page structure
    const html = `
      <html>
        <head>
          <title>Just a moment...</title>
          <script>window.__CF$cv$params={r:"7f3a8c912d04e001",t:"MTY5MDAwMDAwMC4wMDAwMDA="};
          window.__cf_chl_opt={cvId:'2',cZone:"example.com",cType:'non-interactive'}</script>
        </head>
        <body>
          <div id="cf-wrapper">
            <div class="cf-browser-verification cf-im-under-attack" id="cf-hcaptcha-container">
              <p>Checking your browser before accessing example.com</p>
            </div>
          </div>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('GENUINE-2: CF interstitial with __cf_chl_opt (structural signal) is still caught', () => {
    const html = `
      <html>
        <head><title>Please wait...</title></head>
        <body>
          <script>window.__cf_chl_opt={cvId:'3',cZone:"blocked.com"};</script>
          <div>Please complete the security check to access blocked.com</div>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('GENUINE-3: Real DataDome challenge page (dd_challenge form present) is still caught', () => {
    // Real DataDome block page structure — has the challenge form / captcha markers
    const html = `
      <html>
        <head><title>Access Denied</title></head>
        <body>
          <div id="dd_challenge">
            <p>Powered by DataDome</p>
            <form action="/datadome/captcha/" method="POST">
              <input type="hidden" name="captcha_token" value="abc123"/>
              <button>Verify you are human</button>
            </form>
          </div>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('GENUINE-4: CF page where "just a moment" is the page title (case-insensitive) is still caught', () => {
    // The CF challenge page always has this as its *title*
    const html = `
      <html>
        <head><title>Just a moment...</title></head>
        <body>
          <div id="cf-browser-verification">
            <p>This process is automatic. Your browser will redirect to your requested content shortly.</p>
          </div>
          <script>window.__CF$cv$params={r:"abc",t:"def"};</script>
        </body>
      </html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it('FP-4: CF 5xx error page with "ray-id" CSS class does NOT trigger (it is an error page, not a challenge)', () => {
    // CF error pages show "Ray ID" in a specific structured section.
    // A 522 Connection Timed Out is NOT a bot challenge — it is a server error.
    // The bare "ray id" substring match incorrectly classifies this as a bot challenge.
    // After fix: structural check required ("ray id" alone in a CF error page is not sufficient).
    const html = `
      <html>
        <head><title>522: Connection timed out</title></head>
        <body>
          <div class="cf-error-details">
            <p>The web server reported a gateway time-out error.</p>
            <p>Error 522 Ray ID: 7f3a8c912d04e001 2024-01-15 10:30:00 UTC</p>
          </div>
          <div class="cf-section">
            <div class="cf-col">
              <p class="ray-id">Ray ID: <strong>7f3a8c912d04e001</strong></p>
            </div>
          </div>
        </body>
      </html>
    `;
    // This should NOT be a bot challenge — it is a Cloudflare error page.
    expect(detectBotChallenge(html)).toBe(false);
  });
});

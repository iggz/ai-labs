/**
 * routing.spec.js — Playwright test for protocol-based backend routing
 *
 * Validates that selecting Metal (YOLO) in the UI routes POST requests to the Mac
 * backend (api-mac.ilovetoridemybicycle.com), DML routes to the PC backend
 * (api.ilovetoridemybicycle.com), and CUDA (default, RTX 5090) routes to the PC backend too.
 *
 * Uses request interception to capture the outbound URL — no real upload
 * is sent (all matching requests are aborted after the host is captured).
 *
 * Usage:
 *   npx playwright test tests/routing.spec.js --headed
 */

import { test, expect } from '@playwright/test';

const BASE_URL   = 'https://ilovetoridemybicycle.com/ai-labs';
const MAC_HOST   = 'api-mac.ilovetoridemybicycle.com';
const PC_HOST    = 'api.ilovetoridemybicycle.com';

/**
 * Navigate to /form-ai, bypass the onboarding gate via localStorage,
 * intercept the outbound POST, and return the destination host.
 */
async function getSubmitHostForProtocol(page, protocol) {
  // Set storage state before loading the page so React reads it immediately
  await page.addInitScript((p) => {
    localStorage.setItem('formai_onboarded', 'true');  // bypass onboarding gate
    localStorage.setItem('hhb_protocol', p);           // set the protocol
    localStorage.removeItem('AILABS_CV_API_URL');       // clear any dev override
  }, protocol);

  await page.goto(`${BASE_URL}/form-ai`, { waitUntil: 'networkidle' });

  // Intercept and abort all requests to /api/v1/analyze/* so we capture the
  // host without actually submitting anything to the backend.
  let capturedHost = null;
  await page.route('**/api/v1/analyze/**', async (route) => {
    const url = new URL(route.request().url());
    capturedHost = url.hostname;
    await route.abort(); // don't actually send it
  });

  // Wait for the file input — it has id="formai-file-input"
  const fileInput = page.locator('#formai-file-input');
  await fileInput.waitFor({ state: 'attached', timeout: 15000 });

  // Feed it a synthetic 1-byte file
  const tinyFile = Buffer.from([0x00]);
  await fileInput.setInputFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: tinyFile,
  });

  // Click the Analyze button to trigger the submit
  const analyzeBtn = page.locator('#formai-analyze-btn');
  await analyzeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await analyzeBtn.click();

  // Wait a moment for the interceptor to fire
  await page.waitForTimeout(3000);

  return capturedHost;
}

test.describe('Protocol routing', () => {
  test('Metal (YOLO) protocol sends POST to Mac backend', async ({ page }) => {
    const host = await getSubmitHostForProtocol(page, 'yolo');
    console.log(`Metal/YOLO → host: ${host}`);
    expect(host).toBe(MAC_HOST);
  });

  test('DML protocol sends POST to PC backend', async ({ page }) => {
    const host = await getSubmitHostForProtocol(page, 'dml');
    console.log(`DML → host: ${host}`);
    expect(host).toBe(PC_HOST);
  });

  test('OpenCV protocol sends POST to PC backend', async ({ page }) => {
    const host = await getSubmitHostForProtocol(page, 'opencv');
    console.log(`OpenCV → host: ${host}`);
    expect(host).toBe(PC_HOST);
  });

  test('CUDA protocol sends POST to PC backend', async ({ page }) => {
    const host = await getSubmitHostForProtocol(page, 'cuda');
    console.log(`CUDA → host: ${host}`);
    expect(host).toBe(PC_HOST);
  });

  test('Default protocol is CUDA, and a saved legacy DML pref migrates to it', async ({ page }) => {
    for (const saved of [null, 'dml']) {
      await page.addInitScript((pref) => {
        localStorage.setItem('formai_onboarded', 'true');
        if (pref) localStorage.setItem('hhb_protocol', pref);
        else localStorage.removeItem('hhb_protocol');   // fresh session → default
      }, saved);
      await page.goto(`${BASE_URL}/form-ai`, { waitUntil: 'networkidle' });
      await expect(page.locator('#formai-protocol-cuda')).toHaveAttribute('aria-checked', 'true');
    }
  });
});

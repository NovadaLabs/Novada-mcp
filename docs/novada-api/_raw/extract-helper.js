// This JS runs inside the browser page to extract all curl examples
// Used by Playwright evaluate() on each platform page
async function extractAllCurls() {
  const results = [];
  const getCurl = () => {
    for (const tb of document.querySelectorAll('textarea')) {
      if (tb.value?.includes('scraper_id=')) return tb.value;
    }
    return null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const seen = new Set();
  const SKIP = ['Residential','My Products','Wallet\n','Billing\n','Partners\n','KYC','Beginner','Account Settings','Documentation and Help','Rotating','Static ISP','Dedicated Datacenter','Mobile Proxies','Web Unblocker','Scraper API','Browser API','Pack Redemption','Referral Program'];

  for (const item of document.querySelectorAll('[role="menuitem"]')) {
    const text = item.textContent?.trim() || '';
    if (SKIP.some(s => text.includes(s))) continue;
    item.click();
    await sleep(500);
    const curl = getCurl();
    if (curl) {
      const idMatch = curl.match(/scraper_id=([^\s\\"&]+)/);
      const sid = idMatch?.[1] || '?';
      if (!seen.has(sid)) {
        seen.add(sid);
        const sceneName = text.replace(/\$[\d.]+\/\d+K.*/,'').trim().replace(/\s+/g,' ').substring(0,80);
        results.push({scene: sceneName, scraper_id: sid, curl: curl});
      }
    }
  }
  return JSON.stringify(results);
}

import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[ERROR] ${e.message}`));

await page.goto('http://127.0.0.1:3000/#joc', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 2000));

const info = await page.evaluate(() => {
  const r = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, height: b.height, width: b.width, display: getComputedStyle(el).display };
  };
  const joc = document.querySelector('[data-view="joc"]');
  return {
    app: r(document.querySelector('.app')),
    sidebar: r(document.querySelector('.sidebar')),
    main: r(document.querySelector('.main-content')),
    joc: r(joc),
    home: r(document.querySelector('[data-view="home"]')),
    viewHeader: r(joc?.querySelector('.view-header')),
    section: r(joc?.querySelector('section.section-padding')),
    footer: r(document.querySelector('.footer-bauxa')),
    bodyHeight: document.body.scrollHeight,
  };
});

await page.screenshot({ path: '/tmp/pup-joc-full.png', fullPage: true });
console.log(JSON.stringify(info, null, 2));
console.log('---LOGS---');
console.log(logs.slice(0, 12).join('\n'));

await browser.close();

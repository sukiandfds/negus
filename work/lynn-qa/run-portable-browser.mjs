import fs from 'node:fs/promises';
const {origin,token}=JSON.parse(await fs.readFile(new URL('./access.json',import.meta.url),'utf8'));
process.env.LYNN_TEST_ORIGIN=origin;process.env.LYNN_TEST_TOKEN=token;
process.env.CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await import('/Users/hans/myproject/lynn-photo-workbench/tests/browser.mjs');

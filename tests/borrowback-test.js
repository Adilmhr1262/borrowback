/* BorrowBack verification suite (headless Firefox via playwright-core).
   Serves the project over local HTTP, then runs the order's 18 acceptance
   tests across fresh browser contexts. Usage: node tests/borrowback-test.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-16-borrowback';
const PORT = 8140;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.join(PROJECT, urlPath);
      if (!file.startsWith(PROJECT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function addDaysStr(dateStr, days) {
  const p = dateStr.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

async function dbState(page) {
  return await Promise.race([
    page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('borrowback-db', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['records', 'settings'], 'readonly');
        const recs = tx.objectStore('records').getAll();
        const theme = tx.objectStore('settings').get('theme');
        const thr = tx.objectStore('settings').get('dueSoonDays');
        const out = {};
        let done = 0;
        const finish = () => { if (++done === 3) resolve(out); };
        recs.onsuccess = () => { out.records = recs.result; finish(); };
        theme.onsuccess = () => { out.theme = theme.result ? theme.result.value : null; finish(); };
        thr.onsuccess = () => { out.dueSoonDays = thr.result ? thr.result.value : null; finish(); };
        recs.onerror = theme.onerror = thr.onerror = () => reject(new Error('dbState request failed'));
        tx.onerror = () => reject(new Error('dbState transaction failed'));
      };
      req.onerror = () => reject(new Error('open failed'));
    })),
    sleep(15000).then(() => { throw new Error('dbState timed out after 15s'); })
  ]);
}

async function gotoSection(page, name) {
  await page.click('[data-nav="' + name + '"]:visible');
  await sleep(150);
}

async function addRecord(page, opts) {
  await gotoSection(page, 'records');
  await page.click('#records-add-btn');
  await page.waitForSelector('#record-dialog[open]', { timeout: 5000 });
  if (opts.direction) await page.check('input[name="direction"][value="' + opts.direction + '"]');
  if (opts.item !== undefined) await page.fill('#f-item', opts.item);
  if (opts.person !== undefined) await page.fill('#f-person', opts.person);
  if (opts.category !== undefined) await page.selectOption('#f-category', opts.category);
  if (opts.qty !== undefined) await page.fill('#f-quantity', String(opts.qty));
  if (opts.start !== undefined) await page.fill('#f-start', opts.start);
  if (opts.due !== undefined && opts.due !== null) await page.fill('#f-due', opts.due);
  if (opts.notes !== undefined) await page.fill('#f-notes', opts.notes);
  await page.click('#record-submit');
  try {
    await page.waitForFunction(() => !document.getElementById('record-dialog').open, null, { timeout: 10000 });
  } catch (e) {
    const diag = await page.evaluate(() => {
      const vis = id => { const n = document.getElementById(id); return n && !n.hidden ? n.textContent : ''; };
      return {
        dialogOpen: document.getElementById('record-dialog').open,
        formError: vis('form-error'),
        errItem: vis('err-item'), errPerson: vis('err-person'), errCategory: vis('err-category'),
        errQuantity: vis('err-quantity'), errStart: vis('err-start'), errDue: vis('err-due'), errNotes: vis('err-notes'),
        itemValue: document.getElementById('f-item').value,
        toast: document.getElementById('toast').textContent
      };
    }).catch(err => ({ diagError: String(err) }));
    console.log('ADDRECORD-DIAG for ' + JSON.stringify(opts) + ': ' + JSON.stringify(diag));
    throw e;
  }
}

async function cardBadgeTexts(page, listSelector) {
  return await page.$$eval(listSelector + ' .record-card', cards =>
    cards.map(c => ({
      title: (c.querySelector('.record-title') || {}).textContent || '',
      badges: Array.from(c.querySelectorAll('.badge')).map(b => b.textContent)
    })));
}

(async () => {
  // Watchdog: never hang silently; the outer timeout kills the run, this
  // makes the cause visible in the log instead.
  const watchdog = setTimeout(() => { console.error('WATCHDOG: suite still running after 900s'); process.exit(3); }, 900000);
  watchdog.unref();
  const server = await serve();
  const browser = await firefox.launch();
  const externalRequests = [];
  const consoleErrors = [];
  const pageErrors = [];

  async function freshPage() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:' + PORT)) externalRequests.push(r.url()); });
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(BASE, { waitUntil: 'load' });
    await sleep(600);
    return { context, page };
  }

  // ---- Group A: fresh state, add + persistence, no-due-date, validation ----
  {
    const { context, page } = await freshPage();
    const today = await page.evaluate(() => window.BorrowBackDates.todayLocal());

    check('A1 fresh: all counters zero', (await page.textContent('#stat-lent')) === '0' &&
      (await page.textContent('#stat-borrowed')) === '0' &&
      (await page.textContent('#stat-overdue')) === '0' &&
      (await page.textContent('#stat-completed')) === '0');
    check('A1 fresh: empty state shown, no records', await page.isVisible('#dash-empty') &&
      (await dbState(page)).records.length === 0);

    await addRecord(page, { direction: 'lent', item: 'Power Drill', person: 'Ali Raza', category: 'Tools', qty: 1, start: today, due: addDaysStr(today, 10), notes: 'With extra battery' });
    check('A2 add Lent record: dialog closed, toast shown', !(await page.$('#record-dialog[open]')) &&
      (await page.textContent('#toast')) === 'Record added.');
    check('A2 stats: Lent Out 1', (await page.textContent('#stat-lent')) === '1');
    await page.reload({ waitUntil: 'load' }); await sleep(600);
    const st = await dbState(page);
    check('A2 persistence after reload', st.records.length === 1 && st.records[0].itemName === 'Power Drill' &&
      st.records[0].personName === 'Ali Raza' && st.records[0].quantity === 1 &&
      st.records[0].startDate === today && st.records[0].dueDate === addDaysStr(today, 10));
    await gotoSection(page, 'records');
    const cards = await cardBadgeTexts(page, '#records-list');
    check('A2 record card shows item, Lent, On Track', cards.length === 1 && cards[0].badges.includes('Lent') && cards[0].badges.includes('On Track'));

    await addRecord(page, { direction: 'borrowed', item: 'Novel: Dune', person: 'Sara Ahmed', category: 'Books', qty: 1, start: today, due: null });
    const cards2 = await cardBadgeTexts(page, '#records-list');
    const dune = cards2.find(c => c.title === 'Novel: Dune');
    check('A3 borrowed without due date: No Due Date, never overdue', dune && dune.badges.includes('No Due Date') &&
      !dune.badges.includes('Overdue') && (await page.textContent('#stat-overdue')) === '0' &&
      (await page.textContent('#stat-borrowed')) === '1');

    // Validation: blank item name, valid input kept, dialog stays open
    await page.click('#records-add-btn');
    await page.waitForSelector('#record-dialog[open]');
    await page.fill('#f-person', 'Test Person');
    await page.selectOption('#f-category', 'Tools');
    await page.fill('#f-start', today);
    await page.click('#record-submit');
    await sleep(300);
    check('A4 blank item name rejected, dialog stays open', await page.$('#record-dialog[open]') !== null);
    const errVisible = await page.isVisible('#err-item');
    const personKept = (await page.inputValue('#f-person')) === 'Test Person';
    check('A4 inline error shown and valid input kept', errVisible && personKept);
    await page.keyboard.press('Escape'); await sleep(200);

    // Quantity 0 rejected
    await page.click('#records-add-btn');
    await page.waitForSelector('#record-dialog[open]');
    await page.fill('#f-item', 'Bad Qty Item');
    await page.fill('#f-person', 'Test Person');
    await page.selectOption('#f-category', 'Tools');
    await page.fill('#f-quantity', '0');
    await page.fill('#f-start', today);
    await page.click('#record-submit');
    await sleep(300);
    check('A4 quantity 0 rejected', await page.$('#record-dialog[open]') !== null && await page.isVisible('#err-quantity'));
    await page.keyboard.press('Escape'); await sleep(200);

    // Due before start rejected
    await page.click('#records-add-btn');
    await page.waitForSelector('#record-dialog[open]');
    await page.fill('#f-item', 'Bad Dates');
    await page.fill('#f-person', 'Test Person');
    await page.selectOption('#f-category', 'Tools');
    await page.fill('#f-start', today);
    await page.fill('#f-due', addDaysStr(today, -1));
    await page.click('#record-submit');
    await sleep(300);
    check('A4 due before start rejected', await page.$('#record-dialog[open]') !== null && await page.isVisible('#err-due'));
    await page.keyboard.press('Escape'); await sleep(200);

    // Future start date rejected
    await page.click('#records-add-btn');
    await page.waitForSelector('#record-dialog[open]');
    await page.fill('#f-item', 'Future Start');
    await page.fill('#f-person', 'Test Person');
    await page.selectOption('#f-category', 'Tools');
    await page.fill('#f-start', addDaysStr(today, 5));
    await page.click('#record-submit');
    await sleep(300);
    check('A4 future start date rejected', await page.$('#record-dialog[open]') !== null && await page.isVisible('#err-start'));
    await page.keyboard.press('Escape'); await sleep(200);

    // Overlong item name rejected (101 chars; set via evaluate because the
    // maxlength attribute truncates typed input at 100)
    await page.click('#records-add-btn');
    await page.waitForSelector('#record-dialog[open]');
    await page.evaluate(() => { document.getElementById('f-item').value = 'x'.repeat(101); });
    await page.fill('#f-person', 'Test Person');
    await page.selectOption('#f-category', 'Tools');
    await page.fill('#f-start', today);
    await page.click('#record-submit');
    await sleep(300);
    const stAfter = await dbState(page);
    check('A4 101-char item name rejected, count unchanged', stAfter.records.length === 2 &&
      await page.$('#record-dialog[open]') !== null);
    await page.keyboard.press('Escape'); await sleep(200);

    // HTML in a name is rendered as text, not an element
    await addRecord(page, { direction: 'lent', item: '<img src=x onerror=alert(1)>', person: 'HTML Tester', category: 'Other', qty: 1, start: today, due: null });
    const imgCount = await page.$$eval('#records-list .record-card img', els => els.length);
    check('A4 HTML in item name rendered as text (no element created)', imgCount === 0);
    await context.close();
  }

  // ---- Group B: status boundaries + configurable threshold ----
  {
    const { context, page } = await freshPage();
    const today = await page.evaluate(() => window.BorrowBackDates.todayLocal());
    await addRecord(page, { direction: 'lent', item: 'Overdue Hammer', person: 'P1', category: 'Tools', qty: 1, start: addDaysStr(today, -10), due: addDaysStr(today, -2) });
    await addRecord(page, { direction: 'lent', item: 'Today Wrench', person: 'P2', category: 'Tools', qty: 1, start: today, due: today });
    await addRecord(page, { direction: 'borrowed', item: 'Soon Saw', person: 'P3', category: 'Tools', qty: 1, start: today, due: addDaysStr(today, 3) });
    await addRecord(page, { direction: 'borrowed', item: 'Later Ladder', person: 'P4', category: 'Tools', qty: 1, start: today, due: addDaysStr(today, 10) });
    await gotoSection(page, 'records');
    const cards = await cardBadgeTexts(page, '#records-list');
    const badgeOf = t => (cards.find(c => c.title === t) || { badges: [] }).badges;
    check('B5 overdue badge', badgeOf('Overdue Hammer').includes('Overdue'));
    check('B5 due-today badge', badgeOf('Today Wrench').includes('Due Today'));
    check('B5 due-soon badge (threshold 7)', badgeOf('Soon Saw').includes('Due Soon'));
    check('B5 on-track badge', badgeOf('Later Ladder').includes('On Track'));
    await gotoSection(page, 'dashboard');
    check('B5 dashboard: overdue 1, attention 1, due soon 2', (await page.textContent('#stat-overdue')) === '1' &&
      (await page.textContent('#attention-count')) === '1' &&
      (await page.textContent('#due-soon-count')) === '2');
    // Threshold 1 day: Soon Saw (+3) becomes On Track; Due Soon drops to 1 (today only)
    await gotoSection(page, 'settings');
    await page.selectOption('#due-soon-select', '1');
    await sleep(400);
    await gotoSection(page, 'records');
    const cards2 = await cardBadgeTexts(page, '#records-list');
    const badgeOf2 = t => (cards2.find(c => c.title === t) || { badges: [] }).badges;
    check('B5 threshold 1: +3d record becomes On Track', badgeOf2('Soon Saw').includes('On Track'));
    await gotoSection(page, 'dashboard');
    check('B5 threshold 1: dashboard Due Soon now 1', (await page.textContent('#due-soon-count')) === '1');
    await context.close();
  }

  // ---- Group C: search/filters, edit, return, late return, reopen, delete ----
  {
    const { context, page } = await freshPage();
    const today = await page.evaluate(() => window.BorrowBackDates.todayLocal());
    await addRecord(page, { direction: 'lent', item: 'Power Drill', person: 'Ali Raza', category: 'Tools', qty: 2, start: today, due: addDaysStr(today, 5), notes: 'red case' });
    await addRecord(page, { direction: 'borrowed', item: 'Physics Textbook', person: 'Sara Ahmed', category: 'Books', qty: 1, start: addDaysStr(today, -10), due: addDaysStr(today, -1) });
    await addRecord(page, { direction: 'lent', item: 'Winter Jacket', person: 'Bilal Khan', category: 'Clothing', qty: 1, start: today, due: null });
    await gotoSection(page, 'records');

    // Search
    await page.fill('#search-input', 'drill'); await sleep(300);
    let shown = await page.$$eval('#records-list .record-card', cs => cs.length);
    check('C6 search "drill" finds 1', shown === 1);
    await page.fill('#search-input', 'RED CASE'); await sleep(300);
    shown = await page.$$eval('#records-list .record-card', cs => cs.length);
    check('C6 search is case-insensitive and covers notes', shown === 1);
    await page.fill('#search-input', ''); await sleep(200);

    // Combined filters: direction + category + status
    await page.selectOption('#filter-direction', 'borrowed');
    await page.selectOption('#filter-category', 'Books');
    await page.selectOption('#filter-status', 'overdue');
    await sleep(300);
    shown = await page.$$eval('#records-list .record-card', cs => cs.length);
    check('C6 combined direction+category+status filters (AND)', shown === 1);
    // No-match state + clear filters
    await page.selectOption('#filter-category', 'Electronics');
    await sleep(300);
    check('C6 no-match state shown', await page.isVisible('#records-no-match'));
    await page.click('#clear-filters-btn'); await sleep(300);
    shown = await page.$$eval('#records-list .record-card', cs => cs.length);
    check('C6 clear filters restores all 3', shown === 3);
    // Sort by item name A-Z
    await page.selectOption('#sort-select', 'item'); await sleep(300);
    const titles = await page.$$eval('#records-list .record-title', els => els.map(e => e.textContent));
    check('C6 sort Item Name A-Z', JSON.stringify(titles) === JSON.stringify(['Physics Textbook', 'Power Drill', 'Winter Jacket']), titles.join(','));

    // Edit: change quantity and due date, reload, verify
    await page.selectOption('#sort-select', 'due-date'); await sleep(200);
    const cards = await page.$$('#records-list .record-card');
    for (const c of cards) {
      const t = await c.$eval('.record-title', e => e.textContent);
      if (t === 'Power Drill') {
        const btns = await c.$$('.action-btn');
        for (const b of btns) { if ((await b.textContent()) === 'Edit') { await b.click(); break; } }
        break;
      }
    }
    await page.waitForSelector('#record-dialog[open]');
    check('C7 edit form prefilled', (await page.inputValue('#f-item')) === 'Power Drill' && (await page.inputValue('#f-quantity')) === '2');
    await page.fill('#f-quantity', '3');
    await page.fill('#f-due', addDaysStr(today, 9));
    await page.click('#record-submit');
    await page.waitForFunction(() => !document.getElementById('record-dialog').open, null, { timeout: 10000 });
    await sleep(200);
    await page.reload({ waitUntil: 'load' }); await sleep(600);
    const st = await dbState(page);
    const drill = st.records.find(r => r.itemName === 'Power Drill');
    check('C7 edit persists after reload', drill && drill.quantity === 3 && drill.dueDate === addDaysStr(today, 9));

    // Mark Returned: default return date today, leaves active, enters History
    await gotoSection(page, 'records');
    const cards2 = await page.$$('#records-list .record-card');
    for (const c of cards2) {
      const t = await c.$eval('.record-title', e => e.textContent);
      if (t === 'Physics Textbook') {
        const btns = await c.$$('.action-btn');
        for (const b of btns) { if ((await b.textContent()) === 'Mark Returned') { await b.click(); break; } }
        break;
      }
    }
    await page.waitForSelector('#return-dialog[open]');
    check('C8 return dialog defaults to today', (await page.inputValue('#f-return-date')) === today);
    await page.click('#return-form button[type="submit"]');
    await page.waitForFunction(() => !document.getElementById('return-dialog').open, null, { timeout: 10000 });
    await sleep(200);
    await gotoSection(page, 'dashboard');
    check('C8 returned record leaves active lists, Completed 1', (await page.textContent('#stat-completed')) === '1' &&
      (await page.textContent('#stat-borrowed')) === '0');
    await gotoSection(page, 'history');
    const hCards = await cardBadgeTexts(page, '#history-list');
    check('C8 history shows returned record', hCards.length === 1 && hCards[0].title === 'Physics Textbook' &&
      hCards[0].badges.includes('Returned') && hCards[0].badges.includes('Returned Late'));

    // Return late is shown above (due -1, returned today). Now reopen it.
    const hCardEls = await page.$$('#history-list .record-card');
    for (const c of hCardEls) {
      const btns = await c.$$('.action-btn');
      for (const b of btns) { if ((await b.textContent()) === 'Reopen') { await b.click(); break; } }
    }
    await page.waitForSelector('#confirm-dialog[open]');
    await page.click('#confirm-ok-btn'); await sleep(400);
    const st2 = await dbState(page);
    const reopened = st2.records.find(r => r.itemName === 'Physics Textbook');
    check('C10 reopen returns record to Active, return date cleared', reopened && reopened.returnedAt === null);
    await gotoSection(page, 'history');
    check('C10 history empty after reopen', await page.isVisible('#history-empty'));

    // Delete: cancel keeps it, confirm removes it
    await gotoSection(page, 'records');
    const cards3 = await page.$$('#records-list .record-card');
    for (const c of cards3) {
      const t = await c.$eval('.record-title', e => e.textContent);
      if (t === 'Winter Jacket') {
        const btns = await c.$$('.action-btn');
        for (const b of btns) { if ((await b.textContent()) === 'Delete') { await b.click(); break; } }
        break;
      }
    }
    await page.waitForSelector('#confirm-dialog[open]');
    await page.click('#confirm-dialog [data-close]'); await sleep(300);
    let st3 = await dbState(page);
    check('C11 delete cancelled: record still there', st3.records.some(r => r.itemName === 'Winter Jacket'));
    const cards4 = await page.$$('#records-list .record-card');
    for (const c of cards4) {
      const t = await c.$eval('.record-title', e => e.textContent);
      if (t === 'Winter Jacket') {
        const btns = await c.$$('.action-btn');
        for (const b of btns) { if ((await b.textContent()) === 'Delete') { await b.click(); break; } }
        break;
      }
    }
    await page.waitForSelector('#confirm-dialog[open]');
    await page.click('#confirm-ok-btn'); await sleep(400);
    st3 = await dbState(page);
    check('C11 delete confirmed: record gone', !st3.records.some(r => r.itemName === 'Winter Jacket') && st3.records.length === 2);
    await context.close();
  }

  // ---- Group D: theme/threshold persistence, backup export/import, delete-all ----
  {
    const { context, page } = await freshPage();
    const today = await page.evaluate(() => window.BorrowBackDates.todayLocal());
    await addRecord(page, { direction: 'lent', item: 'Camping Tent', person: 'Omar Farooq', category: 'Household', qty: 1, start: today, due: addDaysStr(today, 4) });
    await addRecord(page, { direction: 'borrowed', item: 'Soldering Iron', person: 'Hina Malik', category: 'Electronics', qty: 1, start: today, due: null });

    await gotoSection(page, 'settings');
    await page.check('input[name="theme"][value="dark"]');
    await sleep(300);
    await page.selectOption('#due-soon-select', '3');
    await sleep(400);
    await page.reload({ waitUntil: 'load' }); await sleep(600);
    check('D12 dark theme persists after reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    await gotoSection(page, 'settings');
    check('D12 threshold 3 persists after reload', (await page.inputValue('#due-soon-select')) === '3');
    await page.check('input[name="theme"][value="light"]'); await sleep(300);

    // Export
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#export-btn');
    const download = await downloadPromise;
    const dlPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
    check('D13 export: version 1, 2 records, timestamp, filename pattern',
      exported.formatVersion === 1 && exported.records.length === 2 && typeof exported.exportedAt === 'string' &&
      download.suggestedFilename().startsWith('borrowback-backup-') && download.suggestedFilename().endsWith('.json'),
      download.suggestedFilename());

    // Add a third record, then import the backup: exact restoration
    await addRecord(page, { direction: 'lent', item: 'Extra Item', person: 'Nobody', category: 'Other', qty: 1, start: today, due: null });
    let st = await dbState(page);
    check('D13 pre-import has 3 records', st.records.length === 3);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'borrowback-'));
    const backupPath = path.join(tmpDir, 'backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(exported));
    await gotoSection(page, 'settings');
    await page.setInputFiles('#import-file', backupPath);
    await sleep(400);
    await page.waitForSelector('#confirm-dialog[open]');
    const confirmText = await page.textContent('#confirm-text');
    check('D13 import confirm shows counts', /2 record/.test(confirmText) && /0 completed/.test(confirmText), confirmText);
    await page.click('#confirm-ok-btn'); await sleep(500);
    st = await dbState(page);
    check('D13 import restores exactly the 2 backup records', st.records.length === 2 &&
      st.records.some(r => r.itemName === 'Camping Tent') && st.records.some(r => r.itemName === 'Soldering Iron') &&
      !st.records.some(r => r.itemName === 'Extra Item'));

    // Rejected backups leave data unchanged
    async function tryBadBackup(name, obj, raw) {
      const p = path.join(tmpDir, name);
      fs.writeFileSync(p, raw !== undefined ? raw : JSON.stringify(obj));
      await page.setInputFiles('#import-file', p);
      await sleep(400);
      const status = await page.textContent('#import-status');
      const s = await dbState(page);
      return { status, count: s.records.length };
    }
    let bad = await tryBadBackup('malformed.json', null, '{not json');
    check('D14 malformed backup rejected, data unchanged', bad.count === 2 && /not valid JSON|rejected/i.test(bad.status), bad.status);
    const dup = JSON.parse(JSON.stringify(exported));
    dup.records.push(JSON.parse(JSON.stringify(dup.records[0])));
    bad = await tryBadBackup('dup.json', dup);
    check('D14 duplicate-ID backup rejected, data unchanged', bad.count === 2 && /Duplicate record id/i.test(bad.status), bad.status);
    const badDate = JSON.parse(JSON.stringify(exported));
    badDate.records[0].startDate = '2026-13-40';
    bad = await tryBadBackup('baddate.json', badDate);
    check('D14 invalid-date backup rejected, data unchanged', bad.count === 2 && /Invalid start date/i.test(bad.status), bad.status);
    const badVer = JSON.parse(JSON.stringify(exported));
    badVer.formatVersion = 99;
    bad = await tryBadBackup('badver.json', badVer);
    check('D14 unsupported version rejected, data unchanged', bad.count === 2 && /Unsupported format version/i.test(bad.status), bad.status);

    // Delete all: wrong word rejected, DELETE works
    await page.click('#delete-all-btn');
    await page.waitForSelector('#delete-all-dialog[open]');
    await page.fill('#f-delete-word', 'delete');
    await page.click('#delete-all-form button[type="submit"]'); await sleep(300);
    st = await dbState(page);
    check('D15 wrong DELETE word rejected', st.records.length === 2 && await page.$('#delete-all-dialog[open]') !== null);
    await page.fill('#f-delete-word', 'DELETE');
    await page.click('#delete-all-form button[type="submit"]'); await sleep(500);
    st = await dbState(page);
    check('D15 DELETE clears all records, settings reset', st.records.length === 0 && st.theme === null && st.dueSoonDays === null);
    await gotoSection(page, 'dashboard');
    check('D15 all counters zero after delete-all', (await page.textContent('#stat-lent')) === '0' &&
      (await page.textContent('#stat-completed')) === '0' && await page.isVisible('#dash-empty'));
    await context.close();
  }

  // ---- Group E: keyboard/dialogs, responsive, external requests ----
  {
    const { context, page } = await freshPage();
    // Keyboard: focus Add Record button, open with Enter, close with Escape, focus returns
    await page.click('#quick-add-btn'); // ensure dashboard visible first
    await page.keyboard.press('Escape'); await sleep(200);
    await page.evaluate(() => document.querySelector('#quick-add-btn').focus());
    await page.keyboard.press('Enter'); await sleep(300);
    check('E16 dialog opens from keyboard', await page.$('#record-dialog[open]') !== null);
    await page.keyboard.press('Escape'); await sleep(300);
    check('E16 Escape closes dialog and focus returns to trigger',
      await page.$('#record-dialog[open]') === null &&
      (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'quick-add-btn');
    // Reduced motion respected in CSS
    const css = fs.readFileSync(path.join(PROJECT, 'styles.css'), 'utf8');
    check('E16 reduced-motion media query present', css.includes('prefers-reduced-motion'));

    // Responsive widths: no horizontal overflow; nav mode switches at 768px
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 800 });
      await sleep(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const sidebarVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display !== 'none');
      const bottomNavVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none');
      check('E17 ' + w + 'px: no horizontal overflow', overflow <= 0, 'overflow ' + overflow + 'px');
      if (w < 768) check('E17 ' + w + 'px: bottom nav shown, sidebar hidden', bottomNavVisible && !sidebarVisible);
      else check('E17 ' + w + 'px: sidebar shown, bottom nav hidden', sidebarVisible && !bottomNavVisible);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // Details dialog from dashboard card click
    const today = await page.evaluate(() => window.BorrowBackDates.todayLocal());
    await addRecord(page, { direction: 'lent', item: 'Keyboard Test', person: 'Zara Ali', category: 'Electronics', qty: 1, start: today, due: addDaysStr(today, 2) });
    await gotoSection(page, 'dashboard');
    await page.click('#recent-list .record-card'); await sleep(300);
    check('E16 clicking a dashboard record opens details', await page.$('#details-dialog[open]') !== null &&
      (await page.textContent('#details-body')).includes('Keyboard Test'));
    await page.keyboard.press('Escape'); await sleep(200);
    await context.close();
  }

  check('E18 no external network requests', externalRequests.length === 0, externalRequests.join(', '));
  check('E18 zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('E18 zero page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (fail) { console.log('Failed checks:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });

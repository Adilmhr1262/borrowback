# BorrowBack — Personal Lending Tracker

Tagline: "Lend it. Track it. Get it back."

BorrowBack answers three simple questions: Who has my stuff? What do I need to return? What's overdue? It tracks physical items you lend to others or borrow from them — books, chargers, tools, clothing, electronics — with no accounts, no backend, and no cloud.

## Features

- **Dashboard** — live counts of Lent Out, Borrowed, Overdue, and Completed; Needs Attention (overdue first), Due Soon, and Recent Activity lists.
- **My Records** — add, edit, view, return, and delete lending/borrowing records. Item and person names, category, quantity (1–999), start date, optional due date, and notes. Inline validation keeps valid input after a failed submission.
- **Status** — computed from the local calendar date: On Track, Due Soon (configurable threshold), Due Today, Overdue, No Due Date, Returned. A record without a due date never becomes overdue.
- **Search and filters** — search item, person, and notes; filter by direction, category, and status; sort by due date, recency, or name. Filters combine.
- **Return and reopen** — mark a record returned with a return date between its start date and today; reopen an accidentally completed record after confirmation.
- **History** — every returned record, with start date, due date, actual return date, and a "Returned Late" flag when the return came after the due date.
- **Settings** — Light, Dark, or System theme; due-soon threshold (1, 3, 7, or 14 days); JSON backup export and import; delete-all-data guarded by typing DELETE.
- **Local-only storage** — everything lives in IndexedDB (`borrowback-db`) in your browser and survives reloads and restarts. No external requests, no tracking, no analytics.

## How to use it

1. Open `index.html` in a browser, or serve the folder over local HTTP.
2. Click **Add Record**, choose "I Lent It" or "I Borrowed It", and fill in the item and person.
3. Add a due date if you want BorrowBack to watch it. The Dashboard shows what is overdue and what is due soon.
4. When an item comes back, open the record and choose **Mark Returned**, then pick the return date.
5. In **Settings**, export a backup (`borrowback-backup-YYYY-MM-DD.json`) before clearing browser data — importing a backup replaces all current records and settings after confirmation.

## Backup and restore limits

- Backups are JSON files, format version 1, at most 5 MB.
- Import validates the whole file first: unsupported versions, malformed objects, duplicate record IDs, invalid dates, quantities, categories, directions, or statuses are all rejected, and your existing data is left untouched.
- Restore is atomic: the import only replaces data after the file passes validation and you confirm.
- Backups contain only your records and settings. If you lose the file, deleted records cannot be recovered.

## Files

- `index.html` — structure, four sections, dialogs
- `styles.css` — Navy/Cream/Amber design, light and dark themes, responsive layout
- `app.js` — UI logic, validation, status calculation, rendering
- `db.js` — IndexedDB layer (`borrowback-db`, version 1)
- `date-utils.js` — local calendar-date helpers (dates stored as `YYYY-MM-DD`)
- `backup.js` — backup format, export, and full import validation

## Development

No build step and no dependencies. To run the verification suite (headless Firefox via playwright-core):

```
node tests/borrowback-test.js
```

The suite covers the order's 18 acceptance tests: fresh empty state, persistence, validation rejections, status boundaries, search/filter combinations, edit, return/reopen, delete confirmation, theme and threshold persistence, backup export/import and rejection, delete-all, keyboard/dialog behaviour, responsive layouts from 320px to 1440px, and zero external requests or console errors.

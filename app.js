/* BorrowBack — Personal Lending Tracker (app logic).
   Single-page app: Dashboard, My Records, History, Settings.
   All user text is rendered with textContent; no unsanitized innerHTML. */
(function () {
  'use strict';

  var D = window.BorrowBackDates;
  var DB = window.BorrowBackDB;
  var Backup = window.BorrowBackBackup;

  var state = {
    records: [],
    settings: { theme: 'system', dueSoonDays: 7 },
    section: 'dashboard',
    filters: { search: '', direction: 'all', category: 'all', status: 'all', sort: 'due-date' },
    history: { search: '', direction: 'all', sort: 'return-newest' },
    editingId: null,
    detailsId: null,
    returnId: null,
    lastFocused: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function showToast(message) {
    var toast = $('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 3500);
  }

  function showError(message) {
    var box = $('form-error');
    box.textContent = message;
    box.hidden = false;
  }

  /* ---------- Status ---------- */
  function statusOf(record) {
    if (record.returnedAt) return 'returned';
    if (!record.dueDate) return 'no-due-date';
    var days = D.daysBetween(D.todayLocal(), record.dueDate);
    if (days < 0) return 'overdue';
    if (days === 0) return 'due-today';
    if (days <= state.settings.dueSoonDays) return 'due-soon';
    return 'on-track';
  }

  var STATUS_LABELS = {
    'on-track': 'On Track',
    'due-soon': 'Due Soon',
    'due-today': 'Due Today',
    'overdue': 'Overdue',
    'returned': 'Returned',
    'no-due-date': 'No Due Date'
  };

  function directionLabel(d) { return d === 'lent' ? 'Lent' : 'Borrowed'; }

  function activeRecords() { return state.records.filter(function (r) { return !r.returnedAt; }); }
  function completedRecords() { return state.records.filter(function (r) { return !!r.returnedAt; }); }

  /* ---------- Theme ---------- */
  function applyTheme() {
    var t = state.settings.theme;
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('borrowback-theme', t); } catch (e) { /* storage unavailable */ }
    document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.checked = radio.value === t;
    });
  }

  /* ---------- Navigation ---------- */
  function showSection(name) {
    state.section = name;
    document.querySelectorAll('.section').forEach(function (s) { s.classList.remove('is-visible'); });
    $('section-' + name).classList.add('is-visible');
    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      var active = btn.getAttribute('data-nav') === name;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    if (name === 'dashboard') renderDashboard();
    if (name === 'records') renderRecords();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  /* ---------- Record cards ---------- */
  function statusBadge(record) {
    var s = statusOf(record);
    return el('span', 'badge badge-' + s, STATUS_LABELS[s]);
  }

  function buildRecordCard(record, actions) {
    var li = el('li');
    var card = el('article', 'record-card');
    var top = el('div', 'record-top');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h3', 'record-title', record.itemName));
    titleWrap.appendChild(el('p', 'record-person', directionLabel(record.direction) + ' · ' + record.personName));
    top.appendChild(titleWrap);
    var badges = el('div', 'badges');
    badges.appendChild(el('span', 'badge badge-' + record.direction, directionLabel(record.direction)));
    badges.appendChild(statusBadge(record));
    if (record.returnedAt && record.dueDate && D.daysBetween(record.dueDate, record.returnedAt) > 0) {
      badges.appendChild(el('span', 'badge badge-late', 'Returned Late'));
    }
    top.appendChild(badges);
    card.appendChild(top);

    var meta = el('p', 'record-meta');
    meta.appendChild(el('span', null, record.category));
    meta.appendChild(el('span', null, 'Qty ' + record.quantity));
    meta.appendChild(el('span', null, 'Started ' + D.displayDate(record.startDate)));
    if (record.dueDate) meta.appendChild(el('span', null, 'Due ' + D.displayDate(record.dueDate)));
    if (record.returnedAt) meta.appendChild(el('span', null, 'Returned ' + D.displayDate(record.returnedAt)));
    card.appendChild(meta);

    if (record.notes) card.appendChild(el('p', 'record-notes', record.notes));

    var act = el('div', 'card-actions');
    actions.forEach(function (a) {
      var b = el('button', 'action-btn' + (a.cls ? ' ' + a.cls : ''), a.label);
      b.type = 'button';
      b.addEventListener('click', function (e) { e.stopPropagation(); a.onClick(record); });
      act.appendChild(b);
    });
    card.appendChild(act);
    li.appendChild(card);
    return li;
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    var active = activeRecords();
    var completed = completedRecords();
    var today = D.todayLocal();
    var overdue = active.filter(function (r) { return statusOf(r) === 'overdue'; });
    var lent = active.filter(function (r) { return r.direction === 'lent'; }).length;
    var borrowed = active.filter(function (r) { return r.direction === 'borrowed'; }).length;

    $('stat-lent').textContent = String(lent);
    $('stat-borrowed').textContent = String(borrowed);
    $('stat-overdue').textContent = String(overdue.length);
    $('stat-completed').textContent = String(completed.length);

    var hasAny = state.records.length > 0;
    $('dash-empty').hidden = hasAny;
    $('dash-lists').hidden = !hasAny;
    if (!hasAny) return;

    overdue.sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    var attention = overdue.slice(0, 5);
    $('attention-count').textContent = String(overdue.length);
    renderListInto($('attention-list'), attention, true);
    $('attention-empty').hidden = attention.length > 0;

    var dueSoon = active.filter(function (r) {
      if (!r.dueDate) return false;
      var days = D.daysBetween(today, r.dueDate);
      return days >= 0 && days <= state.settings.dueSoonDays;
    }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; }).slice(0, 5);
    $('due-soon-count').textContent = String(active.filter(function (r) {
      if (!r.dueDate) return false;
      var days = D.daysBetween(today, r.dueDate);
      return days >= 0 && days <= state.settings.dueSoonDays;
    }).length);
    $('due-soon-sub').textContent = 'Due today or within the next ' + state.settings.dueSoonDays + ' day' +
      (state.settings.dueSoonDays === 1 ? '' : 's') + '.';
    renderListInto($('due-soon-list'), dueSoon, true);
    $('due-soon-empty').hidden = dueSoon.length > 0;

    var recent = state.records.slice().sort(function (a, b) {
      return a.updatedAt < b.updatedAt ? 1 : -1;
    }).slice(0, 5);
    renderListInto($('recent-list'), recent, true);
    $('recent-empty').hidden = recent.length > 0;
  }

  function renderListInto(listEl, records, compact) {
    listEl.textContent = '';
    records.forEach(function (r) {
      var li = el('li');
      var card = el('button', 'record-card');
      card.type = 'button';
      card.setAttribute('aria-label', r.itemName + ' — ' + r.personName + ' — ' + STATUS_LABELS[statusOf(r)]);
      var top = el('div', 'record-top');
      var titleWrap = el('div');
      titleWrap.appendChild(el('h3', 'record-title', r.itemName));
      titleWrap.appendChild(el('p', 'record-person', directionLabel(r.direction) + ' · ' + r.personName));
      top.appendChild(titleWrap);
      var badges = el('div', 'badges');
      badges.appendChild(statusBadge(r));
      top.appendChild(badges);
      card.appendChild(top);
      var meta = el('p', 'record-meta');
      if (r.dueDate) meta.appendChild(el('span', null, 'Due ' + D.displayDate(r.dueDate)));
      else meta.appendChild(el('span', null, 'Started ' + D.displayDate(r.startDate)));
      if (r.returnedAt) meta.appendChild(el('span', null, 'Returned ' + D.displayDate(r.returnedAt)));
      card.appendChild(meta);
      card.addEventListener('click', function () { openDetails(r.id); });
      li.appendChild(card);
      listEl.appendChild(li);
    });
  }

  /* ---------- Records ---------- */
  function filteredActive() {
    var f = state.filters;
    var q = f.search.trim().toLowerCase();
    var out = activeRecords().filter(function (r) {
      if (f.direction !== 'all' && r.direction !== f.direction) return false;
      if (f.category !== 'all' && r.category !== f.category) return false;
      if (f.status !== 'all' && statusOf(r) !== f.status) return false;
      if (q) {
        var hay = (r.itemName + ' ' + r.personName + ' ' + (r.notes || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (f.sort === 'due-date') {
        if (!a.dueDate && !b.dueDate) return b.createdAt < a.createdAt ? -1 : 1;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        return b.createdAt < a.createdAt ? -1 : 1;
      }
      if (f.sort === 'recent') return a.createdAt < b.createdAt ? 1 : -1;
      if (f.sort === 'oldest') return a.createdAt < b.createdAt ? -1 : 1;
      if (f.sort === 'item') return a.itemName.toLowerCase().localeCompare(b.itemName.toLowerCase());
      if (f.sort === 'person') return a.personName.toLowerCase().localeCompare(b.personName.toLowerCase());
      return 0;
    });
    return out;
  }

  function renderRecords() {
    var active = activeRecords();
    $('records-count').textContent = active.length + ' active';
    var list = filteredActive();
    var listEl = $('records-list');
    listEl.textContent = '';
    var filtersActive = state.filters.search.trim() !== '' || state.filters.direction !== 'all' ||
      state.filters.category !== 'all' || state.filters.status !== 'all';
    $('records-empty').hidden = active.length > 0;
    $('records-no-match').hidden = !(active.length > 0 && list.length === 0);
    list.forEach(function (r) {
      listEl.appendChild(buildRecordCard(r, [
        { label: 'View Details', onClick: function (rec) { openDetails(rec.id); } },
        { label: 'Edit', onClick: function (rec) { openRecordForm(rec); } },
        { label: 'Mark Returned', cls: 'primary', onClick: function (rec) { openReturnDialog(rec.id); } },
        { label: 'Delete', cls: 'danger', onClick: function (rec) { askDelete(rec); } }
      ]));
    });
  }

  /* ---------- History ---------- */
  function renderHistory() {
    var completed = completedRecords();
    $('history-count').textContent = completed.length + ' completed';
    var h = state.history;
    var q = h.search.trim().toLowerCase();
    var list = completed.filter(function (r) {
      if (h.direction !== 'all' && r.direction !== h.direction) return false;
      if (q) {
        var hay = (r.itemName + ' ' + r.personName).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (h.sort === 'return-newest') return a.returnedAt < b.returnedAt ? 1 : -1;
      if (h.sort === 'return-oldest') return a.returnedAt < b.returnedAt ? -1 : 1;
      if (h.sort === 'item') return a.itemName.toLowerCase().localeCompare(b.itemName.toLowerCase());
      return 0;
    });
    var listEl = $('history-list');
    listEl.textContent = '';
    $('history-empty').hidden = completed.length > 0;
    $('history-no-match').hidden = !(completed.length > 0 && list.length === 0);
    list.forEach(function (r) {
      listEl.appendChild(buildRecordCard(r, [
        { label: 'View', onClick: function (rec) { openDetails(rec.id); } },
        { label: 'Reopen', onClick: function (rec) { askReopen(rec); } },
        { label: 'Delete', cls: 'danger', onClick: function (rec) { askDelete(rec); } }
      ]));
    });
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    $('due-soon-select').value = String(state.settings.dueSoonDays);
    var total = state.records.length;
    $('data-total').textContent = String(total);
    $('data-active').textContent = String(activeRecords().length);
    $('data-completed').textContent = String(completedRecords().length);
  }

  function renderAll() {
    renderDashboard();
    renderRecords();
    renderHistory();
    renderSettings();
  }

  /* ---------- Dialog helpers ---------- */
  function openDialog(dlg) {
    state.lastFocused = document.activeElement;
    if (!dlg.open) dlg.showModal();
    var focusable = dlg.querySelector('input, select, textarea, button:not([data-close])') ||
      dlg.querySelector('button');
    if (focusable) focusable.focus();
  }

  function wireDialogClose(dlg) {
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', function () {
      if (state.lastFocused && document.contains(state.lastFocused)) state.lastFocused.focus();
      state.lastFocused = null;
    });
    dlg.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { dlg.close(); });
    });
  }

  var confirmCallback = null;
  function askConfirm(title, text, okLabel, callback) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    var okBtn = $('confirm-ok-btn');
    okBtn.textContent = okLabel;
    confirmCallback = callback;
    openDialog($('confirm-dialog'));
  }
  $('confirm-ok-btn').addEventListener('click', function () {
    $('confirm-dialog').close();
    if (confirmCallback) { var cb = confirmCallback; confirmCallback = null; cb(); }
  });

  /* ---------- Record form ---------- */
  function clearFieldErrors() {
    ['item', 'person', 'category', 'quantity', 'start', 'due', 'notes', 'direction'].forEach(function (k) {
      var errEl = $('err-' + k);
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    });
    ['f-item', 'f-person', 'f-category', 'f-quantity', 'f-start', 'f-due', 'f-notes'].forEach(function (id) {
      $(id).removeAttribute('aria-invalid');
    });
    $('form-error').hidden = true;
  }

  function setFieldError(key, message) {
    var errEl = $('err-' + key);
    errEl.textContent = message;
    errEl.hidden = false;
    var map = { item: 'f-item', person: 'f-person', category: 'f-category', quantity: 'f-quantity', start: 'f-start', due: 'f-due', notes: 'f-notes' };
    if (map[key]) $(map[key]).setAttribute('aria-invalid', 'true');
  }

  function readForm() {
    var direction = (document.querySelector('input[name="direction"]:checked') || {}).value || '';
    return {
      direction: direction,
      itemName: $('f-item').value.trim(),
      personName: $('f-person').value.trim(),
      category: $('f-category').value,
      quantity: $('f-quantity').value,
      startDate: $('f-start').value,
      dueDate: $('f-due').value || null,
      notes: $('f-notes').value.trim()
    };
  }

  function validateFormValues(v, existing) {
    var errors = {};
    if (Backup.DIRECTIONS.indexOf(v.direction) === -1) errors.direction = 'Choose whether you lent it or borrowed it.';
    if (v.itemName.length < 2 || v.itemName.length > 100) errors.item = 'Item name must be 2–100 characters.';
    if (v.personName.length < 2 || v.personName.length > 80) errors.person = 'Person name must be 2–80 characters.';
    if (Backup.CATEGORIES.indexOf(v.category) === -1) errors.category = 'Choose a category.';
    var qty = Number(v.quantity);
    if (v.quantity === '' || !Number.isInteger(qty) || qty < 1 || qty > 999) errors.quantity = 'Quantity must be a whole number from 1 to 999.';
    if (!D.isValidDateString(v.startDate)) errors.start = 'Enter a valid start date.';
    else if (D.daysBetween(v.startDate, D.todayLocal()) < 0) errors.start = 'Start date cannot be in the future.';
    if (v.dueDate) {
      if (!D.isValidDateString(v.dueDate)) errors.due = 'Enter a valid due date.';
      else if (D.isValidDateString(v.startDate) && D.daysBetween(v.startDate, v.dueDate) < 0)
        errors.due = 'Due date cannot be before the start date.';
    }
    if (v.notes.length > 500) errors.notes = 'Notes must be 500 characters or fewer.';
    if (existing && existing.returnedAt && D.isValidDateString(v.startDate) &&
        D.daysBetween(v.startDate, existing.returnedAt) < 0)
      errors.start = 'Start date cannot be after the stored return date (' + D.displayDate(existing.returnedAt) + '). Adjust the return date first.';
    return errors;
  }

  function openRecordForm(record) {
    state.editingId = record ? record.id : null;
    clearFieldErrors();
    $('record-dialog-title').textContent = record ? 'Edit Record' : 'Add Record';
    $('record-submit').textContent = record ? 'Save Changes' : 'Save Record';
    if (record) {
      document.querySelector('input[name="direction"][value="' + record.direction + '"]').checked = true;
      $('f-item').value = record.itemName;
      $('f-person').value = record.personName;
      $('f-category').value = record.category;
      $('f-quantity').value = String(record.quantity);
      $('f-start').value = record.startDate;
      $('f-due').value = record.dueDate || '';
      $('f-notes').value = record.notes || '';
    } else {
      document.querySelector('input[name="direction"][value="lent"]').checked = true;
      $('f-item').value = '';
      $('f-person').value = '';
      $('f-category').value = '';
      $('f-quantity').value = '1';
      $('f-start').value = D.todayLocal();
      $('f-due').value = '';
      $('f-notes').value = '';
    }
    openDialog($('record-dialog'));
  }

  $('record-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var existing = state.editingId ? state.records.find(function (r) { return r.id === state.editingId; }) : null;
    var v = readForm();
    clearFieldErrors();
    var errors = validateFormValues(v, existing);
    var keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach(function (k) { setFieldError(k, errors[k]); });
      showError('Please fix the highlighted fields. Your other entries were kept.');
      var first = keys[0];
      var map = { item: 'f-item', person: 'f-person', category: 'f-category', quantity: 'f-quantity', start: 'f-start', due: 'f-due', notes: 'f-notes' };
      if (map[first]) $(map[first]).focus();
      return;
    }
    var now = new Date().toISOString();
    var record = {
      id: existing ? existing.id : (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
      direction: v.direction,
      itemName: v.itemName,
      personName: v.personName,
      category: v.category,
      quantity: Number(v.quantity),
      startDate: v.startDate,
      dueDate: v.dueDate,
      notes: v.notes,
      returnedAt: existing ? existing.returnedAt : null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    DB.putRecord(record).then(function () {
      if (existing) {
        var idx = state.records.findIndex(function (r) { return r.id === record.id; });
        state.records[idx] = record;
      } else {
        state.records.push(record);
      }
      $('record-dialog').close();
      renderAll();
      showToast(existing ? 'Record updated.' : 'Record added.');
    }).catch(function () {
      showError('Could not save the record. Your browser storage may be unavailable — nothing was changed.');
    });
  });

  /* ---------- Details ---------- */
  function openDetails(id) {
    var r = state.records.find(function (x) { return x.id === id; });
    if (!r) return;
    state.detailsId = id;
    var body = $('details-body');
    body.textContent = '';
    var rows = [
      ['Item', r.itemName],
      ['Person', r.personName],
      ['Direction', directionLabel(r.direction)],
      ['Category', r.category],
      ['Quantity', String(r.quantity)],
      ['Status', STATUS_LABELS[statusOf(r)]],
      ['Start date', D.displayDate(r.startDate)],
      ['Due date', r.dueDate ? D.displayDate(r.dueDate) : 'Not set'],
      ['Return date', r.returnedAt ? D.displayDate(r.returnedAt) : 'Not returned'],
      ['Notes', r.notes || '—']
    ];
    rows.forEach(function (row) {
      var div = el('div');
      div.appendChild(el('dt', null, row[0]));
      div.appendChild(el('dd', null, row[1]));
      body.appendChild(div);
    });
    var isReturned = !!r.returnedAt;
    $('details-edit-btn').hidden = isReturned;
    var retBtn = $('details-return-btn');
    retBtn.textContent = isReturned ? 'Reopen Record' : 'Mark Returned';
    retBtn.className = 'btn ' + (isReturned ? 'btn-secondary' : 'btn-primary');
    openDialog($('details-dialog'));
  }

  $('details-edit-btn').addEventListener('click', function () {
    var r = state.records.find(function (x) { return x.id === state.detailsId; });
    $('details-dialog').close();
    if (r) openRecordForm(r);
  });

  $('details-return-btn').addEventListener('click', function () {
    var r = state.records.find(function (x) { return x.id === state.detailsId; });
    if (!r) return;
    $('details-dialog').close();
    if (r.returnedAt) askReopen(r);
    else openReturnDialog(r.id);
  });

  /* ---------- Return / reopen / delete ---------- */
  function openReturnDialog(id) {
    var r = state.records.find(function (x) { return x.id === id; });
    if (!r) return;
    state.returnId = id;
    $('return-text').textContent = 'Mark "' + r.itemName + '" (' + directionLabel(r.direction) + ' · ' + r.personName + ') as returned. Choose the date it came back.';
    var input = $('f-return-date');
    input.min = r.startDate;
    input.max = D.todayLocal();
    input.value = D.todayLocal();
    var errEl = $('err-return-date');
    errEl.textContent = ''; errEl.hidden = true;
    input.removeAttribute('aria-invalid');
    openDialog($('return-dialog'));
  }

  $('return-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = state.records.find(function (x) { return x.id === state.returnId; });
    if (!r) { $('return-dialog').close(); return; }
    var val = $('f-return-date').value;
    var errEl = $('err-return-date');
    if (!D.isValidDateString(val) || D.daysBetween(r.startDate, val) < 0 || D.daysBetween(val, D.todayLocal()) < 0) {
      errEl.textContent = 'Return date must be between the start date and today.';
      errEl.hidden = false;
      $('f-return-date').setAttribute('aria-invalid', 'true');
      return;
    }
    var updated = Object.assign({}, r, { returnedAt: val, updatedAt: new Date().toISOString() });
    DB.putRecord(updated).then(function () {
      var idx = state.records.findIndex(function (x) { return x.id === updated.id; });
      state.records[idx] = updated;
      $('return-dialog').close();
      renderAll();
      showToast('Marked returned.');
    }).catch(function () {
      errEl.textContent = 'Could not save the return. Nothing was changed.';
      errEl.hidden = false;
    });
  });

  function askReopen(record) {
    askConfirm('Reopen Record',
      'Reopen "' + record.itemName + '"? Its return date will be cleared and it will become active again.',
      'Reopen', function () {
        var updated = Object.assign({}, record, { returnedAt: null, updatedAt: new Date().toISOString() });
        DB.putRecord(updated).then(function () {
          var idx = state.records.findIndex(function (x) { return x.id === updated.id; });
          state.records[idx] = updated;
          renderAll();
          showToast('Record reopened.');
        }).catch(function () { showToast('Could not reopen the record. Nothing was changed.'); });
      });
  }

  function askDelete(record) {
    askConfirm('Delete Record',
      'Permanently delete "' + record.itemName + '" (' + record.personName + ')? This cannot be undone except by restoring a backup.',
      'Delete', function () {
        DB.deleteRecord(record.id).then(function () {
          state.records = state.records.filter(function (x) { return x.id !== record.id; });
          renderAll();
          showToast('Record deleted.');
        }).catch(function () { showToast('Could not delete the record. Nothing was changed.'); });
      });
  }

  /* ---------- Settings actions ---------- */
  document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      state.settings.theme = radio.value;
      applyTheme();
      DB.saveSettings(state.settings).catch(function () { showToast('Theme changed, but it could not be saved.'); });
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (state.settings.theme === 'system') applyTheme();
  });

  $('due-soon-select').addEventListener('change', function () {
    state.settings.dueSoonDays = Number($('due-soon-select').value);
    DB.saveSettings(state.settings).then(function () {
      renderAll();
      showToast('Due-soon threshold updated.');
    }).catch(function () { showToast('Threshold changed, but it could not be saved.'); });
  });

  $('export-btn').addEventListener('click', function () {
    var data = Backup.buildExport(state.records, state.settings);
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Backup.backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    showToast('Backup exported.');
  });

  $('import-btn').addEventListener('click', function () { $('import-file').click(); });

  $('import-file').addEventListener('change', function () {
    var file = $('import-file').files[0];
    $('import-file').value = '';
    if (!file) return;
    var statusEl = $('import-status');
    if (file.size > Backup.MAX_BACKUP_BYTES) {
      statusEl.textContent = 'Backup is too large (over 5 MB). Nothing was changed.';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (err) {
        statusEl.textContent = 'That file is not valid JSON. Nothing was changed.';
        return;
      }
      var result = Backup.validateBackup(parsed);
      if (!result.ok) {
        statusEl.textContent = 'Backup rejected: ' + result.errors.slice(0, 3).join('; ') +
          (result.errors.length > 3 ? ' (and ' + (result.errors.length - 3) + ' more)' : '') + ' Nothing was changed.';
        return;
      }
      var completed = result.records.filter(function (r) { return !!r.returnedAt; }).length;
      askConfirm('Import Backup',
        'Replace all current data with this backup? It contains ' + result.records.length + ' record(s), ' +
        completed + ' completed. Your current records will be replaced.',
        'Import', function () {
          DB.replaceAll(result.records, result.settings).then(function () {
            state.records = result.records;
            state.settings = result.settings;
            applyTheme();
            renderAll();
            statusEl.textContent = 'Backup imported: ' + result.records.length + ' record(s) restored.';
            showToast('Backup imported.');
          }).catch(function () {
            statusEl.textContent = 'Import failed. Your existing data was left unchanged.';
          });
        });
    };
    reader.onerror = function () { statusEl.textContent = 'Could not read that file. Nothing was changed.'; };
    reader.readAsText(file);
  });

  $('delete-all-btn').addEventListener('click', function () {
    $('f-delete-word').value = '';
    var errEl = $('err-delete-word');
    errEl.textContent = ''; errEl.hidden = true;
    openDialog($('delete-all-dialog'));
  });

  $('delete-all-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('f-delete-word').value !== 'DELETE') {
      var errEl = $('err-delete-word');
      errEl.textContent = 'Type DELETE exactly to confirm.';
      errEl.hidden = false;
      $('f-delete-word').setAttribute('aria-invalid', 'true');
      return;
    }
    DB.clearAll().then(function () {
      state.records = [];
      state.settings = { theme: 'system', dueSoonDays: 7 };
      applyTheme();
      $('delete-all-dialog').close();
      renderAll();
      showToast('All data deleted.');
    }).catch(function () {
      $('err-delete-word').textContent = 'Could not delete the data. Nothing was changed.';
      $('err-delete-word').hidden = false;
    });
  });

  /* ---------- Navigation & filters wiring ---------- */
  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () { showSection(btn.getAttribute('data-nav')); });
  });

  function bindAddButtons() {
    ['quick-add-btn', 'empty-add-btn', 'records-add-btn', 'records-empty-add-btn'].forEach(function (id) {
      $(id).addEventListener('click', function () { openRecordForm(null); });
    });
  }

  $('search-input').addEventListener('input', function () { state.filters.search = $('search-input').value; renderRecords(); });
  $('filter-direction').addEventListener('change', function () { state.filters.direction = $('filter-direction').value; renderRecords(); });
  $('filter-category').addEventListener('change', function () { state.filters.category = $('filter-category').value; renderRecords(); });
  $('filter-status').addEventListener('change', function () { state.filters.status = $('filter-status').value; renderRecords(); });
  $('sort-select').addEventListener('change', function () { state.filters.sort = $('sort-select').value; renderRecords(); });

  function clearFilters() {
    state.filters = { search: '', direction: 'all', category: 'all', status: 'all', sort: 'due-date' };
    $('search-input').value = '';
    $('filter-direction').value = 'all';
    $('filter-category').value = 'all';
    $('filter-status').value = 'all';
    $('sort-select').value = 'due-date';
    renderRecords();
  }
  $('clear-filters-btn').addEventListener('click', clearFilters);
  $('no-match-clear-btn').addEventListener('click', clearFilters);

  $('history-search').addEventListener('input', function () { state.history.search = $('history-search').value; renderHistory(); });
  $('history-direction').addEventListener('change', function () { state.history.direction = $('history-direction').value; renderHistory(); });
  $('history-sort').addEventListener('change', function () { state.history.sort = $('history-sort').value; renderHistory(); });

  /* ---------- Init ---------- */
  document.querySelectorAll('dialog').forEach(wireDialogClose);
  bindAddButtons();

  Promise.all([DB.getAllRecords(), DB.getSettings()]).then(function (results) {
    state.records = results[0] || [];
    state.settings = results[1] || { theme: 'system', dueSoonDays: 7 };
    applyTheme();
    renderAll();
  }).catch(function () {
    document.documentElement.dataset.theme = 'light';
    showToast('Storage is unavailable in this browser, so records cannot be saved.');
    renderAll();
  });
})();

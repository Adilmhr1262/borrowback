/* BorrowBack backup validation and export.
   Format version 1. A backup is valid only if every record and the
   settings object pass full validation; nothing is written until then. */
(function (global) {
  'use strict';

  var FORMAT_VERSION = 1;
  var MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  var CATEGORIES = ['Electronics', 'Books', 'Tools', 'Clothing', 'Household', 'Other'];
  var DIRECTIONS = ['lent', 'borrowed'];

  function D() { return global.BorrowBackDates; }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function validateRecord(r, seenIds) {
    var errors = [];
    if (!isPlainObject(r)) return ['Record is not an object'];
    if (typeof r.id !== 'string' || r.id.length === 0) errors.push('Record id is missing or invalid');
    else if (seenIds.has(r.id)) errors.push('Duplicate record id: ' + r.id);
    else seenIds.add(r.id);
    if (DIRECTIONS.indexOf(r.direction) === -1) errors.push('Invalid direction for record ' + (r.id || '?'));
    if (typeof r.itemName !== 'string' || r.itemName.trim().length < 2 || r.itemName.trim().length > 100)
      errors.push('Invalid item name for record ' + (r.id || '?'));
    if (typeof r.personName !== 'string' || r.personName.trim().length < 2 || r.personName.trim().length > 80)
      errors.push('Invalid person name for record ' + (r.id || '?'));
    if (CATEGORIES.indexOf(r.category) === -1) errors.push('Invalid category for record ' + (r.id || '?'));
    if (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999)
      errors.push('Invalid quantity for record ' + (r.id || '?'));
    if (!D().isValidDateString(r.startDate)) errors.push('Invalid start date for record ' + (r.id || '?'));
    if (r.dueDate !== null && r.dueDate !== undefined && !D().isValidDateString(r.dueDate))
      errors.push('Invalid due date for record ' + (r.id || '?'));
    if (r.dueDate && D().isValidDateString(r.startDate) && D().isValidDateString(r.dueDate) &&
        D().daysBetween(r.startDate, r.dueDate) < 0)
      errors.push('Due date precedes start date for record ' + (r.id || '?'));
    if (r.notes !== undefined && r.notes !== null && (typeof r.notes !== 'string' || r.notes.length > 500))
      errors.push('Invalid notes for record ' + (r.id || '?'));
    if (r.returnedAt !== null && r.returnedAt !== undefined && !D().isValidDateString(r.returnedAt))
      errors.push('Invalid return date for record ' + (r.id || '?'));
    if (r.returnedAt && D().isValidDateString(r.startDate) && D().isValidDateString(r.returnedAt) &&
        D().daysBetween(r.startDate, r.returnedAt) < 0)
      errors.push('Return date precedes start date for record ' + (r.id || '?'));
    if (r.returnedAt && D().isValidDateString(r.returnedAt) && D().daysBetween(r.returnedAt, D().todayLocal()) < 0)
      errors.push('Return date is in the future for record ' + (r.id || '?'));
    if (typeof r.createdAt !== 'string' || isNaN(Date.parse(r.createdAt)))
      errors.push('Invalid createdAt for record ' + (r.id || '?'));
    if (typeof r.updatedAt !== 'string' || isNaN(Date.parse(r.updatedAt)))
      errors.push('Invalid updatedAt for record ' + (r.id || '?'));
    return errors;
  }

  function validateSettings(s) {
    var errors = [];
    if (!isPlainObject(s)) return ['Settings is not an object'];
    if (['light', 'dark', 'system'].indexOf(s.theme) === -1) errors.push('Invalid theme in settings');
    if ([1, 3, 7, 14].indexOf(s.dueSoonDays) === -1) errors.push('Invalid due-soon threshold in settings');
    return errors;
  }

  /* Validate a parsed backup object. Returns { ok, errors, records, settings }. */
  function validateBackup(data) {
    var errors = [];
    if (!isPlainObject(data)) return { ok: false, errors: ['Backup is not a JSON object'], records: null, settings: null };
    if (data.formatVersion !== FORMAT_VERSION)
      errors.push('Unsupported format version: ' + String(data.formatVersion));
    if (typeof data.exportedAt !== 'string' || isNaN(Date.parse(data.exportedAt)))
      errors.push('Missing or invalid export timestamp');
    if (!Array.isArray(data.records)) {
      errors.push('Records list is missing or not an array');
      return { ok: false, errors: errors, records: null, settings: null };
    }
    var seenIds = new Set();
    var cleanRecords = [];
    data.records.forEach(function (r) {
      var errs = validateRecord(r, seenIds);
      if (errs.length) errors.push.apply(errors, errs);
      else cleanRecords.push(normalizeRecord(r));
    });
    var settings = null;
    if (data.settings === undefined || data.settings === null) {
      settings = { theme: 'system', dueSoonDays: 7 };
    } else {
      var sErrs = validateSettings(data.settings);
      if (sErrs.length) errors.push.apply(errors, sErrs);
      else settings = { theme: data.settings.theme, dueSoonDays: data.settings.dueSoonDays };
    }
    return { ok: errors.length === 0, errors: errors, records: cleanRecords, settings: settings };
  }

  function normalizeRecord(r) {
    return {
      id: r.id,
      direction: r.direction,
      itemName: r.itemName.trim(),
      personName: r.personName.trim(),
      category: r.category,
      quantity: r.quantity,
      startDate: r.startDate,
      dueDate: r.dueDate || null,
      notes: (r.notes || '').slice(0, 500),
      returnedAt: r.returnedAt || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  }

  function buildExport(records, settings) {
    return {
      formatVersion: FORMAT_VERSION,
      app: 'BorrowBack',
      exportedAt: new Date().toISOString(),
      settings: { theme: settings.theme, dueSoonDays: settings.dueSoonDays },
      records: records.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })
    };
  }

  function backupFilename() {
    return 'borrowback-backup-' + D().todayLocal() + '.json';
  }

  global.BorrowBackBackup = {
    FORMAT_VERSION: FORMAT_VERSION,
    MAX_BACKUP_BYTES: MAX_BACKUP_BYTES,
    CATEGORIES: CATEGORIES,
    DIRECTIONS: DIRECTIONS,
    validateRecord: validateRecord,
    validateSettings: validateSettings,
    validateBackup: validateBackup,
    normalizeRecord: normalizeRecord,
    buildExport: buildExport,
    backupFilename: backupFilename
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* BorrowBack date utilities.
   Dates are stored as YYYY-MM-DD calendar strings and compared as local
   calendar dates. Never convert date-only values through UTC timestamps. */
(function (global) {
  'use strict';

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDateString(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    var parts = value.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.getFullYear() === parts[0] && d.getMonth() === parts[1] - 1 && d.getDate() === parts[2];
  }

  function toDate(value) {
    var parts = value.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayLocal() {
    return formatDate(new Date());
  }

  function addDays(dateStr, days) {
    var d = toDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }

  /* Whole calendar days from a to b (b - a). Negative when b is before a. */
  function daysBetween(a, b) {
    var da = toDate(a).getTime();
    var db = toDate(b).getTime();
    return Math.round((db - da) / 86400000);
  }

  /* Human display, e.g. "16 Nov 2026". Falls back to the raw string. */
  function displayDate(dateStr) {
    if (!isValidDateString(dateStr)) return dateStr || '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var parts = dateStr.split('-').map(Number);
    return parts[2] + ' ' + months[parts[1] - 1] + ' ' + parts[0];
  }

  global.BorrowBackDates = {
    isValidDateString: isValidDateString,
    toDate: toDate,
    formatDate: formatDate,
    todayLocal: todayLocal,
    addDays: addDays,
    daysBetween: daysBetween,
    displayDate: displayDate
  };
})(typeof window !== 'undefined' ? window : globalThis);

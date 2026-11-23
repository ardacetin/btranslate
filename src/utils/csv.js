'use strict';

/**
 * CSV helpers shared by every export (sessions + history).
 *
 * - Quote a cell when it contains a quote, comma, CR or LF (RFC 4180).
 * - Neutralize spreadsheet formula injection: transcript text is user speech,
 *   and a cell starting with = + - @ TAB or CR is evaluated as a formula by
 *   Excel/LibreOffice/Sheets. Prefixing a single quote makes it plain text.
 */
const FORMULA_START_RE = /^[=+\-@\t\r]/;
const NEEDS_QUOTES_RE = /[",\r\n]/;

function csvCell(value) {
  let s = String(value ?? '');
  if (FORMULA_START_RE.test(s)) s = `'${s}`;
  return NEEDS_QUOTES_RE.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

/**
 * Build a whole CSV document. Starts with a UTF-8 BOM so Excel shows Turkish
 * characters correctly, and uses CRLF line endings as RFC 4180 specifies.
 */
function toCsv(header, rows) {
  return '﻿' + [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}

module.exports = { csvCell, csvRow, toCsv };

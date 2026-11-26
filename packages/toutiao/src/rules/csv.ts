/**
 * RFC-4180 CSV 解析/序列化与表格公式注入转义工具（供头条台账使用）。
 */

const FORMULA_RE = /^'*[=+\-@\t\r]/;
const ESCAPED_RE = /^'+[=+\-@\t\r]/;
const NUMBER_RE = /^[+-]?\d+(\.\d+)?%?$/;

export function escapeCsvFormula(value: string): string {
  if (FORMULA_RE.test(value) && !NUMBER_RE.test(value)) return `'${value}`;
  return value;
}

export function unescapeCsvFormula(value: string): string {
  if (ESCAPED_RE.test(value)) return value.slice(1);
  return value;
}

export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function formatCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

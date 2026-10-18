import { isISODate, toDayNumber } from "./dates.js";
import { decimalToFraction, parseMinorUnits } from "./money.js";

export const DATA_FILES = {
  seasons: "seasons.csv",
  hotels: "hotels.csv",
  golf: "golf.csv",
  transfers: "transfers.csv",
  extras: "extras.csv",
  offers: "offers.csv",
  fx: "fx.csv",
  settings: "settings.csv"
};

export const DATA_HEADERS = {
  seasons: ["season", "start_date", "end_date"],
  hotels: ["hotel", "room_type", "board_basis", "max_occupancy", "season", "cost_per_night", "sell_per_night", "cost_single_per_night", "sell_single_per_night", "currency"],
  golf: ["course", "season", "cost_per_round", "sell_per_round", "currency"],
  transfers: ["route", "vehicle", "min_pax", "max_pax", "cost_per_vehicle", "sell_per_vehicle", "currency"],
  extras: ["item", "unit", "cost", "sell", "currency"],
  offers: ["offer_id", "name", "type", "hotel_or_course", "valid_from", "valid_to", "value_1", "value_2", "applies_to"],
  fx: ["currency", "rate_to_gbp", "as_of"],
  settings: ["key", "value"]
};

const REQUIRED_FIELDS = {
  seasons: ["season", "start_date", "end_date"],
  hotels: ["hotel", "room_type", "board_basis", "max_occupancy", "season", "cost_per_night", "sell_per_night", "cost_single_per_night", "sell_single_per_night", "currency"],
  golf: ["course", "season", "cost_per_round", "sell_per_round", "currency"],
  transfers: ["route", "vehicle", "min_pax", "max_pax", "cost_per_vehicle", "sell_per_vehicle", "currency"],
  extras: ["item", "unit", "cost", "sell", "currency"],
  offers: ["offer_id", "name", "type", "hotel_or_course", "valid_from", "valid_to", "value_1", "value_2", "applies_to"],
  fx: ["currency", "rate_to_gbp", "as_of"],
  settings: ["key", "value"]
};
const ALLOWED_EXTRA_UNITS = new Set([
  "per_person",
  "per_player_round",
  "per_buggy_round",
  "per_room_night",
  "per_booking"
]);
const ALLOWED_OFFER_TYPES = new Set(["stay_pay", "early_booking", "free_place"]);
const ALLOWED_APPLIES = new Set(["sell", "cost", "both"]);

export function parseCSV(text) {
  if (typeof text !== "string") throw new TypeError("CSV contents must be text.");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new SyntaxError("The CSV ends inside a quoted field.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  if (new Set(headers).size !== headers.length) throw new SyntaxError("The CSV contains duplicate column names.");
  const records = [];
  for (const [index, values] of rows.slice(1).entries()) {
    if (values.length !== headers.length) {
      throw new SyntaxError(`Row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    }
    records.push({
      ...Object.fromEntries(headers.map((header, column) => [header, values[column].trim()])),
      _rowNumber: index + 2
    });
  }
  return { headers, records };
}

export async function loadData(basePath = "./data/", fetcher = globalThis.fetch) {
  const results = await Promise.all(Object.entries(DATA_FILES).map(async ([key, file]) => {
    try {
      const response = await fetcher(`${basePath}${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return [key, { ...parseCSV(await response.text()), loadError: null }];
    } catch (error) {
      return [key, { headers: [], records: [], loadError: `Could not load ${file}: ${error.message}` }];
    }
  }));
  return Object.fromEntries(results);
}

function add(issues, severity, file, row, message, field = "") {
  issues.push({ severity, file, row, field, message });
}

function requireValues(records, fields, file, issues) {
  for (const record of records) {
    for (const field of fields) {
      if (!String(record[field] ?? "").trim()) {
        add(issues, "error", file, record._rowNumber, `Required value "${field}" is empty.`, field);
      }
    }
  }
}

function checkDate(row, field, file, issues) {
  if (!row[field]) return null;
  if (!isISODate(row[field])) {
    add(issues, "error", file, row._rowNumber, `"${field}" must be a real date in YYYY-MM-DD format.`, field);
    return null;
  }
  return toDayNumber(row[field]);
}

function checkPriceFields(records, fields, file, issues) {
  for (const record of records) {
    for (const field of fields) {
      if (!record[field]) continue;
      try {
        parseMinorUnits(record[field]);
      } catch {
        add(issues, "error", file, record._rowNumber, `"${field}" must be a non-negative price with up to two decimal places.`, field);
      }
    }
    const [costField, sellField] = fields;
    if (record[costField] && record[sellField]) {
      try {
        if (parseMinorUnits(record[sellField]) < parseMinorUnits(record[costField])) {
          add(issues, "warning", file, record._rowNumber, `The sell price is below the cost for "${record.hotel || record.course || record.item || record.vehicle}".`, sellField);
        }
      } catch {
        // A parsing issue has already been reported on the affected price cell.
      }
    }
  }
}

function checkUnique(records, fields, file, issues) {
  const seen = new Set();
  for (const record of records) {
    const key = fields.map((field) => record[field]).join("\u0000");
    if (seen.has(key)) add(issues, "error", file, record._rowNumber, `Duplicate row for ${fields.map((field) => `"${record[field]}"`).join(", ")}.`);
    seen.add(key);
  }
}

export function validateData(data) {
  const issues = [];
  for (const [key, file] of Object.entries(DATA_FILES)) {
    const parsed = data[key];
    if (!parsed || parsed.loadError) {
      add(issues, "error", file, "—", parsed?.loadError || `Could not load ${file}.`);
      continue;
    }
    for (const requiredHeader of DATA_HEADERS[key]) {
      if (!parsed.headers.includes(requiredHeader)) {
        add(issues, "error", file, 1, `Missing or misspelled column "${requiredHeader}".`);
      }
    }
    const records = parsed.records || [];
    requireValues(records, REQUIRED_FIELDS[key], file, issues);
    if (records.length === 0) add(issues, "error", file, "—", "The file has no data rows.");
  }

  const seasons = data.seasons?.records || [];
  for (const season of seasons) {
    const start = checkDate(season, "start_date", DATA_FILES.seasons, issues);
    const end = checkDate(season, "end_date", DATA_FILES.seasons, issues);
    if (start !== null && end !== null && end < start) {
      add(issues, "error", DATA_FILES.seasons, season._rowNumber, "The end date is before the start date.");
    }
  }
  const orderedSeasons = seasons.filter((item) => isISODate(item.start_date) && isISODate(item.end_date) && item.end_date >= item.start_date)
    .slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
  const seenSeasonRanges = new Set();
  for (const season of orderedSeasons) {
    const key = `${season.season}\u0000${season.start_date}\u0000${season.end_date}`;
    if (seenSeasonRanges.has(key)) add(issues, "error", DATA_FILES.seasons, season._rowNumber, "Duplicate season date range.");
    seenSeasonRanges.add(key);
  }
  for (let index = 1; index < orderedSeasons.length; index += 1) {
    const previous = orderedSeasons[index - 1];
    const current = orderedSeasons[index];
    if (current.start_date <= previous.end_date) {
      add(issues, "error", DATA_FILES.seasons, current._rowNumber, `Season dates overlap with row ${previous._rowNumber}.`);
    } else if (toDayNumber(current.start_date) > toDayNumber(previous.end_date) + 1) {
      add(issues, "error", DATA_FILES.seasons, current._rowNumber, `There is a date gap after row ${previous._rowNumber}.`);
    }
  }

  const seasonNames = new Set(seasons.map((row) => row.season));
  const hotels = data.hotels?.records || [];
  const golf = data.golf?.records || [];
  const transfers = data.transfers?.records || [];
  const extras = data.extras?.records || [];
  const offers = data.offers?.records || [];
  const fx = data.fx?.records || [];
  const settings = data.settings?.records || [];

  checkPriceFields(hotels, ["cost_per_night", "sell_per_night"], DATA_FILES.hotels, issues);
  checkPriceFields(golf, ["cost_per_round", "sell_per_round"], DATA_FILES.golf, issues);
  checkPriceFields(transfers, ["cost_per_vehicle", "sell_per_vehicle"], DATA_FILES.transfers, issues);
  checkPriceFields(extras, ["cost", "sell"], DATA_FILES.extras, issues);
  checkUnique(hotels, ["hotel", "room_type", "season"], DATA_FILES.hotels, issues);
  checkUnique(golf, ["course", "season"], DATA_FILES.golf, issues);
  checkUnique(transfers, ["route", "vehicle"], DATA_FILES.transfers, issues);
  checkUnique(extras, ["item"], DATA_FILES.extras, issues);
  checkUnique(offers, ["offer_id"], DATA_FILES.offers, issues);
  checkUnique(fx, ["currency"], DATA_FILES.fx, issues);
  checkUnique(settings, ["key"], DATA_FILES.settings, issues);

  for (const row of hotels) {
    if (row.season && !seasonNames.has(row.season)) add(issues, "error", DATA_FILES.hotels, row._rowNumber, `Hotel price refers to unknown season "${row.season}".`, "season");
    const max = Number(row.max_occupancy);
    if (row.max_occupancy && (!Number.isInteger(max) || max < 1)) {
      add(issues, "error", DATA_FILES.hotels, row._rowNumber, "Maximum occupancy must be a positive whole number.", "max_occupancy");
    }
    if (row.cost_single_per_night) {
      checkPriceFields([row], ["cost_single_per_night", "sell_single_per_night"], DATA_FILES.hotels, issues);
    }
  }
  for (const row of golf) {
    if (row.season && !seasonNames.has(row.season)) add(issues, "error", DATA_FILES.golf, row._rowNumber, `Golf price refers to unknown season "${row.season}".`, "season");
  }
  for (const row of extras) {
    if (row.unit && !ALLOWED_EXTRA_UNITS.has(row.unit)) {
      add(issues, "error", DATA_FILES.extras, row._rowNumber, `Unknown unit "${row.unit}". Use one of: ${[...ALLOWED_EXTRA_UNITS].join(", ")}.`, "unit");
    }
  }
  const rates = new Map();
  for (const row of fx) {
    let rateValid = false;
    try {
      const fraction = decimalToFraction(row.rate_to_gbp);
      rateValid = fraction.numerator > 0n;
    } catch {
      rateValid = false;
    }
    if (!rateValid) {
      add(issues, "error", DATA_FILES.fx, row._rowNumber, "The exchange rate must be a positive number.", "rate_to_gbp");
    } else {
      rates.set(row.currency, row.rate_to_gbp);
    }
    checkDate(row, "as_of", DATA_FILES.fx, issues);
  }
  for (const [key, rows, file] of [
    ["currency", hotels, DATA_FILES.hotels],
    ["currency", golf, DATA_FILES.golf],
    ["currency", transfers, DATA_FILES.transfers],
    ["currency", extras, DATA_FILES.extras]
  ]) {
    rows.forEach((row) => {
      if (row[key] && !rates.has(row[key])) {
        add(issues, "error", file, row._rowNumber, `No exchange rate is supplied for currency "${row[key]}".`, key);
      }
    });
  }

  const routeGroups = transfers.reduce((groups, row) =>
    groups.set(row.route, [...(groups.get(row.route) || []), row]), new Map());
  for (const [route, rows] of routeGroups) {
    const valid = rows.filter((row) => Number.isInteger(Number(row.min_pax)) && Number.isInteger(Number(row.max_pax)) && Number(row.min_pax) > 0 && Number(row.max_pax) >= Number(row.min_pax))
      .slice().sort((a, b) => Number(a.min_pax) - Number(b.min_pax));
    for (const row of rows) {
      if (row.min_pax && row.max_pax && (!Number.isInteger(Number(row.min_pax)) || !Number.isInteger(Number(row.max_pax)) || Number(row.min_pax) < 1 || Number(row.max_pax) < Number(row.min_pax))) {
        add(issues, "error", DATA_FILES.transfers, row._rowNumber, "Passenger range must be positive whole numbers, with maximum at least minimum.");
      }
    }
    if (valid.length && Number(valid[0].min_pax) > 1) {
      add(issues, "error", DATA_FILES.transfers, valid[0]._rowNumber, `Passenger ranges for route "${route}" do not cover groups of one.`);
    }
    for (let index = 1; index < valid.length; index += 1) {
      const previous = valid[index - 1];
      const current = valid[index];
      if (Number(current.min_pax) <= Number(previous.max_pax)) {
        add(issues, "error", DATA_FILES.transfers, current._rowNumber, `Passenger ranges overlap for route "${route}".`);
      } else if (Number(current.min_pax) > Number(previous.max_pax) + 1) {
        add(issues, "error", DATA_FILES.transfers, current._rowNumber, `Passenger ranges have a gap for route "${route}".`);
      }
    }
  }

  const knownHotels = new Set(hotels.map((row) => row.hotel));
  const knownCourses = new Set(golf.map((row) => row.course));
  for (const offer of offers) {
    if (!ALLOWED_OFFER_TYPES.has(offer.type)) add(issues, "error", DATA_FILES.offers, offer._rowNumber, `Unknown offer type "${offer.type}".`);
    if (!ALLOWED_APPLIES.has(offer.applies_to)) add(issues, "error", DATA_FILES.offers, offer._rowNumber, 'Offer applies_to must be "sell", "cost" or "both".');
    const start = checkDate(offer, "valid_from", DATA_FILES.offers, issues);
    const end = checkDate(offer, "valid_to", DATA_FILES.offers, issues);
    if (start !== null && end !== null && end < start) add(issues, "error", DATA_FILES.offers, offer._rowNumber, "Offer valid_to is before valid_from.");
    if (offer.type === "stay_pay" && offer.hotel_or_course !== "ALL" && !knownHotels.has(offer.hotel_or_course)) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, `Offer refers to unknown hotel "${offer.hotel_or_course}".`);
    }
    if (offer.type === "free_place" && offer.hotel_or_course !== "ALL" && !knownCourses.has(offer.hotel_or_course)) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, `Offer refers to unknown course "${offer.hotel_or_course}".`);
    }
    for (const field of ["value_1", "value_2"]) {
      if (offer[field] && (!Number.isFinite(Number(offer[field])) || Number(offer[field]) < 0)) {
        add(issues, "error", DATA_FILES.offers, offer._rowNumber, `"${field}" must be a non-negative number.`);
      }
    }
    if (offer.type === "stay_pay" && (!Number.isSafeInteger(Number(offer.value_1)) || !Number.isSafeInteger(Number(offer.value_2)))) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, "Stay-pay night counts must be whole numbers.");
    }
    if (offer.type === "early_booking" && !Number.isSafeInteger(Number(offer.value_2))) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, "The early-booking minimum lead time must be a whole number of days.");
    }
    if (offer.type === "free_place" && !Number.isSafeInteger(Number(offer.value_1))) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, "The free-place player count must be a whole number.");
    }
    if (offer.type === "stay_pay" && Number(offer.value_1) <= Number(offer.value_2)) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, "A stay-pay offer must give more nights than the paid-night count.");
    }
    if (offer.type === "early_booking" && Number(offer.value_1) > 100) {
      add(issues, "error", DATA_FILES.offers, offer._rowNumber, "An early-booking discount cannot exceed 100 percent.");
    }
  }

  const validSettings = new Map(settings.map((row) => [row.key, row.value]));
  for (const setting of [
    "company_name", "company_address", "company_email", "company_phone",
    "bank_name", "account_name", "sort_code", "account_number", "iban", "swift",
    "deposit_percent", "balance_due_weeks_before_travel", "quote_valid_days",
    "invoice_prefix", "terms_text"
  ]) {
    if (!validSettings.has(setting)) add(issues, "error", DATA_FILES.settings, "—", `Required setting "${setting}" is missing.`);
  }
  for (const [key, value] of validSettings) {
    if (["deposit_percent", "balance_due_weeks_before_travel", "quote_valid_days"].includes(key)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) {
        add(issues, "error", DATA_FILES.settings, settings.find((row) => row.key === key)?._rowNumber ?? "—", `Setting "${key}" must be a non-negative whole number.`);
      } else if (key === "deposit_percent" && number > 100) {
        add(issues, "error", DATA_FILES.settings, settings.find((row) => row.key === key)?._rowNumber ?? "—", 'Setting "deposit_percent" cannot exceed 100.');
      }
    }
  }
  return issues;
}

export function records(data, key) {
  return data[key]?.records || [];
}

export function settingsMap(data) {
  return Object.fromEntries(records(data, "settings").map((row) => [row.key, row.value]));
}

export function dataVersion(data) {
  return JSON.stringify(Object.fromEntries(Object.keys(DATA_FILES).map((key) => [
    key,
    records(data, key).map(({ _rowNumber, ...row }) => row)
  ])));
}

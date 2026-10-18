import { dataVersion, loadData, parseCSV, records, settingsMap, validateData } from "../js/data.js";
import { addDays, addWeeks, datesBetween, daysBetween, formatDate, fromDayNumber, isISODate, todayISO, toDayNumber } from "../js/dates.js";
import { convertMinorToGBP, decimalToFraction, formatGBP, formatMinor, parseMinorUnits, percentOfMinor, roundHalfUp, sumMinor } from "../js/money.js";
import { calculateQuote, calculateTransferCombination, seasonForDate } from "../js/pricing.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseRows(text) {
  const { records, headers } = parseCSV(text);
  return { records, headers, loadError: null };
}

export async function loadSampleData(fetcher = globalThis.fetch) {
  const names = ["seasons", "hotels", "golf", "transfers", "extras", "offers", "fx", "settings"];
  const pairs = await Promise.all(names.map(async (name) => {
    const response = await fetcher(`../data/${name}.csv`);
    if (!response.ok) throw new Error(`Could not load data/${name}.csv`);
    return [name, parseRows(await response.text())];
  }));
  return Object.fromEntries(pairs);
}

export async function runTests(data) {
  const results = [];
  const test = (name, callback) => {
    try {
      const value = callback();
      if (value && typeof value.then === "function") {
        results.push(Promise.resolve(value).then(
          () => ({ name, passed: true }),
          (error) => ({ name, passed: false, error: error.message })
        ));
      } else {
        results.push({ name, passed: true });
      }
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  };
  const equal = (actual, expected, message = "") => {
    if (!Object.is(actual, expected)) throw new Error(`${message ? `${message}: ` : ""}expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  };
  const truthy = (value, message) => {
    if (!value) throw new Error(message || "Expected the value to be truthy.");
  };
  const includesCode = (result, code) => truthy(result.errors.some((item) => item.code === code), `Expected error code "${code}".`);
  const noOffers = (source) => {
    const copy = clone(source);
    copy.offers.records = [];
    return copy;
  };
  const baseInputs = (overrides = {}) => ({
    clientName: "Sample client",
    email: "",
    phone: "",
    leadTraveller: "",
    quoteDate: "2027-01-01",
    internalNotes: "Private sales note",
    travellers: 2,
    golfers: 2,
    hotel: "Aurora Belek Resort",
    checkIn: "2027-05-30",
    checkOut: "2027-06-02",
    roomLines: [{ roomType: "Double", occupancy: 2, rooms: 1 }],
    rounds: [],
    transfers: [],
    extraQuantities: Object.fromEntries(data.extras.records.map((item) => [item.item, 0])),
    ...overrides
  });

  // ISO calendar dates and UTC-only stay arithmetic.
  test("Date accepts a leap-day calendar date", () => equal(isISODate("2028-02-29"), true));
  test("Date rejects a non-leap February 29", () => equal(isISODate("2027-02-29"), false));
  test("Date rejects a month outside the calendar", () => equal(isISODate("2027-13-01"), false));
  test("Date rejects a day outside the month", () => equal(isISODate("2027-04-31"), false));
  test("Date requires exact ISO formatting", () => equal(isISODate("27-04-01"), false));
  test("Date day numbers round-trip across leap years", () => equal(fromDayNumber(toDayNumber("2028-02-29")), "2028-02-29"));
  test("Date counts a cross-month interval", () => equal(daysBetween("2027-05-30", "2027-06-02"), 3));
  test("Date counts leap day as one calendar night", () => equal(daysBetween("2028-02-28", "2028-03-01"), 2));
  test("Date lists nights up to but excluding checkout", () => equal(datesBetween("2027-05-30", "2027-06-02").join(","), "2027-05-30,2027-05-31,2027-06-01"));
  test("Date adds days across a month boundary", () => equal(addDays("2027-05-31", 1), "2027-06-01"));
  test("Date subtracts weeks using whole calendar days", () => equal(addWeeks("2027-05-30", -6), "2027-04-18"));
  test("Date rejects malformed day-number input", () => {
    let rejected = false;
    try { toDayNumber("2027-02-30"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Date formats a calendar date without shifting its day", () => equal(formatDate("2027-05-31"), "31 May 2027"));
  test("Date uses the local calendar date for today", () => equal(todayISO(new Date(2027, 4, 31, 23, 59)), "2027-05-31"));

  // Integer minor units and decimal, half-up GBP conversion.
  test("Money parses whole currency units", () => equal(parseMinorUnits("85"), 8500));
  test("Money parses two decimal places", () => equal(parseMinorUnits("12.34"), 1234));
  test("Money pads one decimal place", () => equal(parseMinorUnits("12.3"), 1230));
  test("Money rejects negative prices", () => {
    let rejected = false;
    try { parseMinorUnits("-1.00"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Money rejects excess price precision", () => {
    let rejected = false;
    try { parseMinorUnits("1.001"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Money represents exact decimal FX as a fraction", () => equal(`${decimalToFraction("0.85").numerator}/${decimalToFraction("0.85").denominator}`, "85/100"));
  test("Money rounds a half penny upward", () => equal(roundHalfUp(1n, 2n), 1));
  test("Money rounds below a half penny downward", () => equal(roundHalfUp(2n, 5n), 0));
  test("Money converts EUR cents to GBP pence at 0.85", () => equal(convertMinorToGBP(10000, "0.85"), 8500));
  test("Money converts GBP one to one", () => equal(convertMinorToGBP(1234, "1.00"), 1234));
  test("Money rounds converted fractional pennies half up", () => equal(convertMinorToGBP(1, "0.85"), 1));
  test("Money calculates a rounded deposit", () => equal(percentOfMinor(99450, "30"), 29835));
  test("Money rounds a percentage half up", () => equal(percentOfMinor(2, "25"), 1));
  test("Money sums integer pence", () => equal(sumMinor([1, 2, 5]), 8));
  test("Money formats GBP with two decimal places", () => equal(formatGBP(123456), "£1,234.56"));
  test("Money formats a minor-unit number without a currency symbol", () => equal(formatMinor(1234), "12.34"));
  test("Money rejects a price outside the safe integer range", () => {
    let rejected = false;
    try { parseMinorUnits("90071992547409.92"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Money rejects a conversion that exceeds the safe integer range", () => {
    let rejected = false;
    try { convertMinorToGBP(Number.MAX_SAFE_INTEGER, "999999999999"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Money rejects an unsafe aggregate total", () => {
    let rejected = false;
    try { sumMinor([Number.MAX_SAFE_INTEGER, 1]); } catch { rejected = true; }
    equal(rejected, true);
  });

  // CSV parsing and cross-file data validation.
  test("CSV parses a quoted comma in a name", () => equal(parseCSV('name,price\n"Sea, View",2').records[0].name, "Sea, View"));
  test("CSV parses an escaped quote", () => equal(parseCSV('name\n"Golf ""Plus"""').records[0].name, 'Golf "Plus"'));
  test("CSV removes blank lines", () => equal(parseCSV("name\none\n\n").records.length, 1));
  test("CSV reports inconsistent row width", () => {
    let rejected = false;
    try { parseCSV("a,b\n1,2,3"); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("CSV reports an unclosed quoted field", () => {
    let rejected = false;
    try { parseCSV('a\n"unclosed'); } catch { rejected = true; }
    equal(rejected, true);
  });
  test("Data sample files have no validation problems", () => equal(validateData(data).length, 0));
  test("Data helper returns parsed rows", () => equal(records(data, "golf").length, 9));
  test("Data helper returns key-value settings", () => equal(settingsMap(data).company_name, "Your Company Name Ltd"));
  test("Data version fingerprints loaded CSV rows", () => truthy(dataVersion(data).includes("Aurora Belek Resort")));
  test("Data loader reports missing files without rejecting all data", async () => {
    const result = await loadData("./data/", async (url) => ({
      ok: !url.endsWith("offers.csv"),
      status: 404,
      text: async () => url.endsWith("seasons.csv") ? "season,start_date,end_date\nPeak,2027-01-01,2027-12-31" : "a,b\n1,2"
    }));
    truthy(result.offers.loadError.includes("offers.csv"));
    equal(result.seasons.records.length, 1);
  });
  test("Data validation reports a missing column", () => {
    const bad = clone(data);
    bad.golf.headers = bad.golf.headers.filter((header) => header !== "currency");
    truthy(validateData(bad).some((item) => item.file === "golf.csv" && item.message.includes('column "currency"')));
  });
  test("Data validation reports duplicate hotel season prices", () => {
    const bad = clone(data);
    bad.hotels.records.push({ ...bad.hotels.records[0], _rowNumber: 99 });
    truthy(validateData(bad).some((item) => item.message.includes("Duplicate row")));
  });
  test("Data validation reports overlapping seasons", () => {
    const bad = clone(data);
    bad.seasons.records[1].start_date = "2027-02-28";
    truthy(validateData(bad).some((item) => item.file === "seasons.csv" && item.message.includes("overlap")));
  });
  test("Data validation reports a gap in seasons", () => {
    const bad = clone(data);
    bad.seasons.records[1].start_date = "2027-03-02";
    truthy(validateData(bad).some((item) => item.file === "seasons.csv" && item.message.includes("gap")));
  });
  test("Data validation reports invalid season dates", () => {
    const bad = clone(data);
    bad.seasons.records[0].end_date = "2027-02-30";
    truthy(validateData(bad).some((item) => item.message.includes("real date")));
  });
  test("Data validation warns when sell is below cost", () => {
    const bad = clone(data);
    bad.golf.records[0].sell_per_round = "1";
    truthy(validateData(bad).some((item) => item.severity === "warning" && item.file === "golf.csv"));
  });
  test("Data validation reports unknown hotel season", () => {
    const bad = clone(data);
    bad.hotels.records[0].season = "Monsoon";
    truthy(validateData(bad).some((item) => item.message.includes('unknown season "Monsoon"')));
  });
  test("Data validation reports missing exchange rates", () => {
    const bad = clone(data);
    bad.fx.records = bad.fx.records.filter((rate) => rate.currency !== "EUR");
    truthy(validateData(bad).some((item) => item.code === "missing_rate" || item.message.includes('currency "EUR"')));
  });
  test("Data validation reports transfer passenger-range gaps", () => {
    const bad = clone(data);
    const vehicle = { ...bad.transfers.records[0], min_pax: "5", max_pax: "7", _rowNumber: 99 };
    bad.transfers.records.push(vehicle);
    truthy(validateData(bad).some((item) => item.file === "transfers.csv" && item.message.includes("overlap")));
  });
  test("Data validation reports unknown extra units", () => {
    const bad = clone(data);
    bad.extras.records[0].unit = "per_tee_time";
    truthy(validateData(bad).some((item) => item.file === "extras.csv" && item.message.includes("Unknown unit")));
  });
  test("Data validation reports empty required fields with row numbers", () => {
    const bad = clone(data);
    bad.hotels.records[0].hotel = "";
    const problem = validateData(bad).find((item) => item.file === "hotels.csv" && item.row === bad.hotels.records[0]._rowNumber);
    truthy(problem);
  });
  test("Data validation reports malformed numeric prices", () => {
    const bad = clone(data);
    bad.hotels.records[0].sell_per_night = "many";
    truthy(validateData(bad).some((item) => item.file === "hotels.csv" && item.message.includes("non-negative price")));
  });
  test("Data validation reports negative supplier prices", () => {
    const bad = clone(data);
    bad.golf.records[0].cost_per_round = "-1";
    truthy(validateData(bad).some((item) => item.file === "golf.csv" && item.message.includes("non-negative price")));
  });
  test("Data validation reports a reversed season range", () => {
    const bad = clone(data);
    bad.seasons.records[0].end_date = "2026-12-31";
    truthy(validateData(bad).some((item) => item.file === "seasons.csv" && item.message.includes("end date is before")));
  });
  test("Data validation reports an exact duplicate season range", () => {
    const bad = clone(data);
    bad.seasons.records.push({ ...bad.seasons.records[0], _rowNumber: 99 });
    truthy(validateData(bad).some((item) => item.file === "seasons.csv" && item.message.includes("Duplicate season")));
  });
  test("Data validation reports invalid decimal FX values", () => {
    const bad = clone(data);
    bad.fx.records.find((row) => row.currency === "EUR").rate_to_gbp = "1e2";
    truthy(validateData(bad).some((item) => item.file === "fx.csv" && item.message.includes("exchange rate")));
  });
  test("Data validation reports overlapping vehicle ranges", () => {
    const bad = clone(data);
    bad.transfers.records[1].min_pax = "3";
    truthy(validateData(bad).some((item) => item.file === "transfers.csv" && item.message.includes("overlap")));
  });
  test("Data validation reports a missing starting passenger count", () => {
    const bad = clone(data);
    bad.transfers.records[0].min_pax = "2";
    truthy(validateData(bad).some((item) => item.file === "transfers.csv" && item.message.includes("do not cover groups of one")));
  });
  test("Data validation reports a missing invoice setting", () => {
    const bad = clone(data);
    bad.settings.records = bad.settings.records.filter((row) => row.key !== "bank_name");
    truthy(validateData(bad).some((item) => item.file === "settings.csv" && item.message.includes('"bank_name"')));
  });
  test("Data validation reports invalid offer dates", () => {
    const bad = clone(data);
    bad.offers.records[0].valid_to = "2026-12-31";
    truthy(validateData(bad).some((item) => item.file === "offers.csv" && item.message.includes("before valid_from")));
  });
  test("Data validation reports fractional stay-pay night counts", () => {
    const bad = clone(data);
    bad.offers.records[0].value_1 = "7.5";
    truthy(validateData(bad).some((item) => item.file === "offers.csv" && item.message.includes("whole numbers")));
  });
  test("Data validation reports an invalid balance term", () => {
    const bad = clone(data);
    bad.settings.records.find((row) => row.key === "balance_due_weeks_before_travel").value = "six";
    truthy(validateData(bad).some((item) => item.file === "settings.csv" && item.message.includes("whole number")));
  });

  // Exact sample rates, seasonal boundaries, and standard booking errors.
  test("Season lookup selects Peak on May 31", () => equal(seasonForDate(data, "2027-05-31").season, "Peak"));
  test("Season lookup selects Summer on June 1", () => equal(seasonForDate(data, "2027-06-01").season, "Summer"));
  test("Season lookup selects Peak on September 16", () => equal(seasonForDate(data, "2027-09-16").season, "Peak"));
  test("Season lookup reports uncovered dates", () => equal(seasonForDate(data, "2028-01-05"), null));
  test("Pricing keeps the exact sample hotel night and room totals", () => {
    const result = calculateQuote(noOffers(data), baseInputs());
    equal(result.errors.length, 0);
    const rooms = result.lines.filter((line) => line.type === "accommodation");
    equal(rooms.map((line) => [line.season, line.quantity, line.totalSellGBP, line.totalCostGBP].join(":")).join(","), "Peak:2:39100:30600,Summer:1:16150:12750");
  });
  test("Pricing keeps the exact Seaside Links sample round total", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ rounds: [{ course: "Seaside Links", date: "2027-05-31", players: 2 }] }));
    const round = result.lines.find((line) => line.type === "golf");
    equal(`${round.totalSellGBP}:${round.totalCostGBP}`, "30600:24650");
  });
  test("Pricing keeps the exact Pine Ridge sample round total", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ rounds: [{ course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 }] }));
    const round = result.lines.find((line) => line.type === "golf");
    equal(`${round.totalSellGBP}:${round.totalCostGBP}`, "13600:10200");
  });
  test("Pricing matches the required hotel and both-round totals", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [
        { course: "Seaside Links", date: "2027-05-31", players: 2 },
        { course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 }
      ]
    }));
    equal(result.totals.totalSellGBP, 99450);
    equal(result.totals.totalCostGBP, 78200);
    equal(result.totals.profitGBP, 21250);
    equal(result.totals.marginPercent.toFixed(1), "21.4");
  });
  test("Pricing rounds on checkout day are allowed", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [{ course: "Olive Grove Golf Club", date: "2027-06-02", players: 2 }]
    }));
    equal(result.errors.some((item) => item.code === "round_outside_stay"), false);
  });
  test("Pricing rejects a round after checkout", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [{ course: "Pine Ridge Golf Club", date: "2027-06-03", players: 2 }]
    }));
    includesCode(result, "round_outside_stay");
  });
  test("Pricing reports a night without a season", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ checkIn: "2028-01-05", checkOut: "2028-01-06" }));
    includesCode(result, "no_season");
  });
  test("Pricing reports check-out not after check-in", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ checkOut: "2027-05-30" }));
    includesCode(result, "invalid_stay");
  });
  test("Pricing requires a client name", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ clientName: " " }));
    includesCode(result, "missing_client");
  });
  test("Pricing prevents golfers exceeding travellers", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ travellers: 1, golfers: 2 }));
    includesCode(result, "golfers_exceed_travellers");
  });
  test("Pricing prevents players exceeding golfers", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [{ course: "Seaside Links", date: "2027-05-31", players: 3 }]
    }));
    includesCode(result, "players_exceed_golfers");
  });
  test("Pricing prevents travellers who do not fit available beds", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ travellers: 3 }));
    includesCode(result, "not_enough_beds");
  });
  test("Pricing selects single-occupancy room prices", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      checkIn: "2027-03-10",
      checkOut: "2027-03-11",
      roomLines: [{ roomType: "Double", occupancy: 1, rooms: 1 }]
    }));
    const room = result.lines.find((line) => line.type === "accommodation");
    equal(`${room.totalSellGBP}:${room.totalCostGBP}`, "16575:12750");
  });
  test("Pricing reports a missing hotel room-season price", () => {
    const bad = clone(data);
    bad.hotels.records = bad.hotels.records.filter((row) => !(row.room_type === "Double" && row.season === "Peak"));
    const result = calculateQuote(bad, baseInputs({ checkIn: "2027-05-31", checkOut: "2027-06-01" }));
    includesCode(result, "missing_hotel_rate");
  });
  test("Pricing reports a missing golf course-season price", () => {
    const bad = clone(data);
    bad.golf.records = bad.golf.records.filter((row) => !(row.course === "Pine Ridge Golf Club" && row.season === "Summer"));
    const result = calculateQuote(bad, baseInputs({ rounds: [{ course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 }] }));
    includesCode(result, "missing_golf_rate");
  });
  test("Pricing reports a missing currency conversion rate", () => {
    const bad = clone(data);
    bad.fx.records = bad.fx.records.filter((row) => row.currency !== "EUR");
    const result = calculateQuote(bad, baseInputs());
    includesCode(result, "missing_rate");
  });
  test("Pricing allows a zero-golfer booking with no rounds", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ travellers: 2, golfers: 0, rounds: [] }));
    equal(result.errors.some((item) => item.code === "invalid_number"), false);
  });
  test("Pricing keeps all quote line amounts in integer pence", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [{ course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 }]
    }));
    truthy(result.lines.every((line) => Number.isSafeInteger(line.totalSellGBP) && Number.isSafeInteger(line.totalCostGBP)));
  });
  test("Pricing computes a 30 percent deposit and exact balance", () => {
    const result = calculateQuote(noOffers(data), baseInputs());
    equal(result.totals.depositGBP + result.totals.balanceGBP, result.totals.totalSellGBP);
    equal(result.totals.depositGBP, percentOfMinor(result.totals.totalSellGBP, "30"));
  });
  test("Pricing marks a balance due within seven days as due now", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      quoteDate: "2027-04-12",
      checkIn: "2027-05-01",
      checkOut: "2027-05-02"
    }));
    equal(result.totals.dueImmediately, true);
    equal(result.totals.amountDueNowGBP, result.totals.totalSellGBP);
  });
  test("Pricing warns when the quote date is after travel starts", () => {
    const result = calculateQuote(noOffers(data), baseInputs({ quoteDate: "2027-06-01" }));
    truthy(result.warnings.some((item) => item.code === "quote_after_travel"));
  });
  test("Pricing applies a stay-pay discount to cheapest nights", () => {
    const inputs = baseInputs({
      checkIn: "2027-03-10",
      checkOut: "2027-03-17",
      quoteDate: "2027-01-01"
    });
    const result = calculateQuote(data, inputs);
    const discount = result.lines.find((line) => line.offerId === "STAY7PAY6");
    equal(discount.totalSellGBP, -19550);
    equal(discount.totalCostGBP, -15300);
  });
  test("Pricing applies early-booking percentage to accommodation", () => {
    const result = calculateQuote(data, baseInputs({
      quoteDate: "2027-04-01",
      checkIn: "2027-08-01",
      checkOut: "2027-08-05"
    }));
    const discount = result.lines.find((line) => line.offerId === "EARLY10");
    equal(discount.totalSellGBP, -6460);
    equal(discount.totalCostGBP, 0);
  });
  test("Pricing applies a free golf place to an eligible round", () => {
    const result = calculateQuote(data, baseInputs({
      travellers: 8,
      golfers: 8,
      roomLines: [{ roomType: "Double", occupancy: 2, rooms: 4 }],
      rounds: [{ course: "Seaside Links", date: "2027-06-01", players: 8 }]
    }));
    const discount = result.lines.find((line) => line.offerId === "GOLF7PLUS");
    equal(discount.totalSellGBP, -8075);
    equal(discount.totalCostGBP, 0);
  });
  test("Pricing does not apply free-place offers to unrelated courses", () => {
    const result = calculateQuote(data, baseInputs({
      travellers: 8,
      golfers: 8,
      roomLines: [{ roomType: "Double", occupancy: 2, rooms: 4 }],
      rounds: [{ course: "Pine Ridge Golf Club", date: "2027-06-01", players: 8 }]
    }));
    equal(result.lines.some((line) => line.offerId === "GOLF7PLUS"), false);
  });
  test("Pricing chooses the cheapest vehicle combination that fits", () => {
    const result = calculateTransferCombination(data, "Antalya Airport - Belek", 9);
    equal(result.errors.length, 0);
    equal(result.combination.sell, 8925);
    equal(result.combination.vehicles.map((vehicle) => `${vehicle.name}:${vehicle.passengers}`).join(","), "Minivan:8,Car:1");
  });
  test("Pricing reports a passenger group that no transfer can carry", () => {
    const limited = clone(data);
    for (const vehicle of limited.transfers.records) {
      if (vehicle.route === "Antalya Airport - Belek") vehicle.min_pax = "2";
    }
    const result = calculateTransferCombination(limited, "Antalya Airport - Belek", 1);
    includesCode(result, "transfer_capacity");
  });
  test("Pricing doubles vehicle cost and sell for a return transfer", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      transfers: [{ route: "Antalya Airport - Belek", passengers: 2, return: true }]
    }));
    const line = result.lines.find((item) => item.type === "transfer");
    equal(`${line.totalSellGBP}:${line.totalCostGBP}`, "6800:4760");
  });
  test("Pricing calculates automatic extra quantities from units", () => {
    const result = calculateQuote(noOffers(data), baseInputs({
      rounds: [
        { course: "Seaside Links", date: "2027-05-31", players: 2 },
        { course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 }
      ],
      extraQuantities: {}
    }));
    const extras = Object.fromEntries(result.lines.filter((line) => line.type === "extra").map((line) => [line.item, line.quantity]));
    equal(extras["Golf bag transport"], 2);
    equal(extras["Club hire"], 4);
    equal(extras["Golf buggy"], 2);
    equal(extras["Resort fee"], 3);
    equal(extras["Booking administration"], 1);
  });
  test("Pricing accepts zero extra quantity overrides", () => {
    const result = calculateQuote(noOffers(data), baseInputs());
    equal(result.lines.some((line) => line.type === "extra"), false);
  });

  const resolved = await Promise.all(results.map((item) => Promise.resolve(item)));
  return { total: resolved.length, passed: resolved.filter((item) => item.passed).length, failed: resolved.filter((item) => !item.passed), results: resolved };
}

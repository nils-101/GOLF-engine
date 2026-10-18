import { addDays, addWeeks, daysBetween, datesBetween, isISODate, todayISO } from "./dates.js";
import { convertMinorToGBP, parseMinorUnits, percentOfMinor, sumMinor } from "./money.js";
import { records, settingsMap } from "./data.js";

function issue(code, message, field = "") {
  return { code, message, field };
}

function whole(value, label, errors, { minimum = 0, required = true, field = label } = {}) {
  if (!required && (value === undefined || value === null || value === "")) return null;
  if (value === undefined || value === null || value === "") {
    errors.push(issue("invalid_number", `${label} is required.`, field));
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    errors.push(issue("invalid_number", `${label} must be a whole number of at least ${minimum}.`, field));
    return null;
  }
  return parsed;
}

function getRate(data, currency) {
  const fx = records(data, "fx").find((row) => row.currency === currency);
  const parsed = fx && Number(fx.rate_to_gbp);
  return Number.isFinite(parsed) && parsed > 0 ? fx.rate_to_gbp : null;
}

function amountMinor(value, label, errors, field) {
  try {
    return parseMinorUnits(value);
  } catch {
    errors.push(issue("missing_price", `${label} is missing or is not a valid price.`, field));
    return null;
  }
}

function toGBP(sourceMinor, currency, data, errors, field, label) {
  const rate = getRate(data, currency);
  if (rate === null) {
    errors.push(issue("missing_rate", `No exchange rate is available for ${currency || "the selected currency"} (${label}).`, field));
    return null;
  }
  try {
    return convertMinorToGBP(sourceMinor, rate);
  } catch {
    errors.push(issue("missing_rate", `The exchange rate for ${currency} is invalid (${label}).`, field));
    return null;
  }
}

function seasonOn(data, date) {
  if (!isISODate(date)) return null;
  return records(data, "seasons").find((season) => season.start_date <= date && date <= season.end_date) || null;
}

function matchesStayPay(offer, hotel, checkIn) {
  return offer.type === "stay_pay"
    && (offer.hotel_or_course === "ALL" || offer.hotel_or_course === hotel)
    && offer.valid_from <= checkIn && checkIn <= offer.valid_to
    && Number(offer.value_1) > Number(offer.value_2)
    && Number(offer.value_2) >= 0;
}

function appliesTo(offer, side) {
  return offer.applies_to === "both" || offer.applies_to === side;
}

function makeLine({ type, description, quantity = 1, unitPriceGBP = 0, totalSellGBP = 0, totalCostGBP = 0, currency = "GBP", field = "", internalOnly = false, details = {} }) {
  return {
    type,
    description,
    quantity,
    unitPriceGBP,
    totalSellGBP: Object.is(totalSellGBP, -0) ? 0 : totalSellGBP,
    totalCostGBP: Object.is(totalCostGBP, -0) ? 0 : totalCostGBP,
    currency,
    field,
    internalOnly,
    ...details
  };
}

function safeSubtotal(lines, side, errors) {
  try {
    return sumMinor(lines.map((line) => line[side]));
  } catch {
    errors.push(issue("amount_overflow", "The quote total is too large to calculate safely."));
    return 0;
  }
}

function priceAccommodation({ data, inputs, roomLine, roomIndex, nights, errors }) {
  const rooms = whole(roomLine.rooms, `Room line ${roomIndex + 1} quantity`, errors, { minimum: 1, field: `roomLines.${roomIndex}.rooms` });
  const occupancy = whole(roomLine.occupancy, `Room line ${roomIndex + 1} occupancy`, errors, { minimum: 1, field: `roomLines.${roomIndex}.occupancy` });
  if (rooms === null || occupancy === null) return { lines: [], nightPrices: [] };
  if (occupancy !== 1 && occupancy !== 2) {
    errors.push(issue("invalid_occupancy", "Room occupancy must be one or two people.", `roomLines.${roomIndex}.occupancy`));
    return { lines: [], nightPrices: [] };
  }
  const rates = records(data, "hotels").filter((row) =>
    row.hotel === inputs.hotel && row.room_type === roomLine.roomType
  );
  if (rates.length === 0) {
    errors.push(issue("missing_hotel", `No room prices are available for ${inputs.hotel || "the selected hotel"} / ${roomLine.roomType || "the selected room"}.`, `roomLines.${roomIndex}.roomType`));
    return { lines: [], nightPrices: [] };
  }
  const maxOccupancy = Math.max(...rates.map((row) => Number(row.max_occupancy)).filter(Number.isFinite));
  if (!Number.isFinite(maxOccupancy) || occupancy > maxOccupancy) {
    errors.push(issue("occupancy_limit", `This room has a maximum occupancy of ${Number.isFinite(maxOccupancy) ? maxOccupancy : "unknown"}; the selected occupancy is ${occupancy}.`, `roomLines.${roomIndex}.occupancy`));
    return { lines: [], nightPrices: [] };
  }

  const grouped = new Map();
  const nightPrices = [];
  for (const date of nights) {
    const season = seasonOn(data, date);
    if (!season) {
      errors.push(issue("no_season", `No season covers the hotel night on ${date}.`, "checkIn"));
      continue;
    }
    const row = rates.find((candidate) => candidate.season === season.season);
    if (!row) {
      errors.push(issue("missing_hotel_rate", `No room price is listed for ${inputs.hotel}, ${roomLine.roomType}, ${season.season}.`, `roomLines.${roomIndex}.roomType`));
      continue;
    }
    const costField = occupancy === 1 ? "cost_single_per_night" : "cost_per_night";
    const sellField = occupancy === 1 ? "sell_single_per_night" : "sell_per_night";
    const costUnit = amountMinor(row[costField], `${row.hotel} ${roomLine.roomType} ${season.season} cost`, errors, costField);
    const sellUnit = amountMinor(row[sellField], `${row.hotel} ${roomLine.roomType} ${season.season} sell price`, errors, sellField);
    if (costUnit === null || sellUnit === null) continue;
    const costGBP = toGBP(costUnit, row.currency, data, errors, "currency", `${row.hotel} ${season.season}`);
    const sellGBP = toGBP(sellUnit, row.currency, data, errors, "currency", `${row.hotel} ${season.season}`);
    if (costGBP === null || sellGBP === null) continue;
    const group = grouped.get(season.season) || { season, row, nights: 0, costUnit, sellUnit };
    group.nights += 1;
    grouped.set(season.season, group);
    nightPrices.push({
      date,
      season,
      row,
      costUnit,
      sellUnit,
      costGBP,
      sellGBP
    });
  }

  const lines = [];
  for (const group of grouped.values()) {
    const quantity = group.nights * rooms;
    const costUnit = group.costUnit;
    const sellUnit = group.sellUnit;
    const sourceCost = costUnit * quantity;
    const sourceSell = sellUnit * quantity;
    if (!Number.isSafeInteger(sourceCost) || !Number.isSafeInteger(sourceSell)) {
      errors.push(issue("amount_overflow", "The accommodation line exceeds the safe price range."));
      continue;
    }
    const costGBP = toGBP(sourceCost, group.row.currency, data, errors, "currency", "hotel accommodation");
    const sellGBP = toGBP(sourceSell, group.row.currency, data, errors, "currency", "hotel accommodation");
    const unitPriceGBP = toGBP(sellUnit, group.row.currency, data, errors, "currency", "hotel room night");
    if (costGBP === null || sellGBP === null || unitPriceGBP === null) continue;
    lines.push(makeLine({
      type: "accommodation",
      description: `${inputs.hotel}, ${roomLine.roomType}, ${group.row.board_basis}, ${group.season.season}: ${group.nights} night${group.nights === 1 ? "" : "s"} x ${rooms} room${rooms === 1 ? "" : "s"}`,
      quantity,
      unitPriceGBP,
      totalSellGBP: sellGBP,
      totalCostGBP: costGBP,
      currency: group.row.currency,
      field: `roomLines.${roomIndex}`,
      details: { season: group.season.season, roomType: roomLine.roomType, boardBasis: group.row.board_basis, nightCount: group.nights, roomCount: rooms, occupancy }
    }));
  }
  return { lines, nightPrices, rooms, occupancy };
}

function applyAccommodationOffers({ data, inputs, roomResults, lines, errors }) {
  const accommodationLines = lines.filter((line) => line.type === "accommodation");
  const offers = records(data, "offers");
  const discounts = [];
  const checkIn = inputs.checkIn;

  for (const { result, roomLine, roomIndex } of roomResults) {
    if (!result.rooms || !result.nightPrices.length) continue;
    for (const offer of offers.filter((candidate) => matchesStayPay(candidate, inputs.hotel, checkIn))) {
      const totalNights = result.nightPrices.length;
      const freeNights = Math.floor(totalNights / Number(offer.value_1))
        * (Number(offer.value_1) - Number(offer.value_2));
      if (freeNights <= 0) continue;
      const cheapest = result.nightPrices.slice().sort((a, b) => a.sellGBP - b.sellGBP).slice(0, freeNights);
      const sourceTotals = new Map();
      for (const night of cheapest) {
        const totals = sourceTotals.get(night.row.currency) || { cost: 0, sell: 0 };
        totals.cost += night.costUnit * result.rooms;
        totals.sell += night.sellUnit * result.rooms;
        sourceTotals.set(night.row.currency, totals);
      }
      let sellDiscount = 0;
      let costDiscount = 0;
      for (const [currency, totals] of sourceTotals) {
        if (appliesTo(offer, "sell")) {
          const converted = toGBP(totals.sell, currency, data, errors, "offers", offer.name);
          if (converted !== null) sellDiscount += converted;
        }
        if (appliesTo(offer, "cost")) {
          const converted = toGBP(totals.cost, currency, data, errors, "offers", offer.name);
          if (converted !== null) costDiscount += converted;
        }
      }
      discounts.push({ offer, label: `${offer.name}: ${freeNights} complimentary night${freeNights === 1 ? "" : "s"}`, sellDiscount, costDiscount, after: accommodationLines.length });
    }
  }

  const quoteDate = inputs.quoteDate;
  const leadDays = isISODate(quoteDate) && isISODate(checkIn) ? daysBetween(quoteDate, checkIn) : -1;
  for (const offer of offers.filter((candidate) => candidate.type === "early_booking"
    && candidate.valid_from <= checkIn && checkIn <= candidate.valid_to
    && leadDays >= Number(candidate.value_2))) {
    const percent = offer.value_1;
    let sellDiscount = 0;
    let costDiscount = 0;
    try {
      if (appliesTo(offer, "sell")) sellDiscount = percentOfMinor(safeSubtotal(accommodationLines, "totalSellGBP", errors), percent);
      if (appliesTo(offer, "cost")) costDiscount = percentOfMinor(safeSubtotal(accommodationLines, "totalCostGBP", errors), percent);
    } catch {
      errors.push(issue("invalid_offer", `The discount percentage for "${offer.name}" is invalid.`, "offers"));
    }
    discounts.push({ offer, label: `${offer.name}: ${percent}% off accommodation`, sellDiscount, costDiscount, after: accommodationLines.length });
  }

  let usedStaySellDiscount = 0;
  let usedStayCostDiscount = 0;
  const accommodationSell = accommodationLines.reduce((total, line) => total + line.totalSellGBP, 0);
  const accommodationCost = accommodationLines.reduce((total, line) => total + line.totalCostGBP, 0);
  for (const discount of discounts) {
    if (discount.label.includes("complimentary night")) {
      discount.sellDiscount = Math.min(discount.sellDiscount, Math.max(0, accommodationSell - usedStaySellDiscount));
      discount.costDiscount = Math.min(discount.costDiscount, Math.max(0, accommodationCost - usedStayCostDiscount));
      usedStaySellDiscount += discount.sellDiscount;
      usedStayCostDiscount += discount.costDiscount;
    } else if (discount.label.includes("% off accommodation")) {
      discount.sellDiscount = Math.min(discount.sellDiscount, Math.max(0, accommodationSell - usedStaySellDiscount));
      discount.costDiscount = Math.min(discount.costDiscount, Math.max(0, accommodationCost - usedStayCostDiscount));
      usedStaySellDiscount += discount.sellDiscount;
      usedStayCostDiscount += discount.costDiscount;
    }
  }
  for (const discount of discounts) {
    if (discount.sellDiscount === 0 && discount.costDiscount === 0) continue;
    lines.push(makeLine({
      type: "discount",
      description: discount.label,
      quantity: 1,
      unitPriceGBP: -discount.sellDiscount,
      totalSellGBP: -discount.sellDiscount,
      totalCostGBP: -discount.costDiscount,
      field: "offers",
      internalOnly: discount.sellDiscount === 0,
      details: { offerId: discount.offer.offer_id }
    }));
  }
}

function findTransferCombination(data, route, passengers, errors, rowIndex) {
  const vehicles = records(data, "transfers").filter((vehicle) => vehicle.route === route)
    .map((vehicle) => {
      const min = Number(vehicle.min_pax);
      const max = Number(vehicle.max_pax);
      const sellUnit = amountMinor(vehicle.sell_per_vehicle, `${vehicle.vehicle} transfer price`, errors, "sell_per_vehicle");
      const costUnit = amountMinor(vehicle.cost_per_vehicle, `${vehicle.vehicle} transfer cost`, errors, "cost_per_vehicle");
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || sellUnit === null || costUnit === null) return null;
      const sellGBP = toGBP(sellUnit, vehicle.currency, data, errors, "currency", vehicle.vehicle);
      const costGBP = toGBP(costUnit, vehicle.currency, data, errors, "currency", vehicle.vehicle);
      if (sellGBP === null || costGBP === null) return null;
      return { ...vehicle, min, max, sellGBP, costGBP };
    }).filter(Boolean);
  if (vehicles.length === 0) {
    errors.push(issue("missing_transfer", `No valid transfer vehicles are configured for ${route || "the selected route"}.`, `transfers.${rowIndex}.route`));
    return null;
  }
  const best = Array(passengers + 1).fill(null);
  best[0] = { sell: 0, cost: 0, vehicles: [] };
  for (let current = 0; current <= passengers; current += 1) {
    if (!best[current]) continue;
    for (const vehicle of vehicles) {
      for (let occupancy = vehicle.min; occupancy <= vehicle.max && current + occupancy <= passengers; occupancy += 1) {
        const next = current + occupancy;
        const candidate = {
          sell: best[current].sell + vehicle.sellGBP,
          cost: best[current].cost + vehicle.costGBP,
          vehicles: [...best[current].vehicles, { name: vehicle.vehicle, passengers: occupancy, sellGBP: vehicle.sellGBP, costGBP: vehicle.costGBP }]
        };
        if (!best[next] || candidate.sell < best[next].sell
          || candidate.sell === best[next].sell && candidate.cost < best[next].cost) best[next] = candidate;
      }
    }
  }
  if (!best[passengers]) {
    errors.push(issue("transfer_capacity", `No vehicle combination on ${route} can carry ${passengers} passenger${passengers === 1 ? "" : "s"}.`, `transfers.${rowIndex}.passengers`));
    return null;
  }
  best[passengers].vehicles.sort((a, b) => b.passengers - a.passengers);
  return best[passengers];
}

function priceGolfRound({ data, round, roundIndex, inputs, errors }) {
  const players = whole(round.players, `Golf round ${roundIndex + 1} players`, errors, { minimum: 1 });
  if (players === null) return null;
  if (players > inputs.golfers) {
    errors.push(issue("players_exceed_golfers", `Golf round ${roundIndex + 1} has more players than the booking has golfers.`, `rounds.${roundIndex}.players`));
    return null;
  }
  if (!isISODate(round.date)) {
    errors.push(issue("invalid_round_date", `Choose a valid date for golf round ${roundIndex + 1}.`, `rounds.${roundIndex}.date`));
    return null;
  }
  if (round.date < inputs.checkIn || round.date > inputs.checkOut) {
    errors.push(issue("round_outside_stay", `Golf round ${roundIndex + 1} on ${round.date} is outside the stay.`, `rounds.${roundIndex}.date`));
    return null;
  }
  const season = seasonOn(data, round.date);
  if (!season) {
    errors.push(issue("no_season", `No season covers golf round ${roundIndex + 1} on ${round.date}.`, `rounds.${roundIndex}.date`));
    return null;
  }
  const row = records(data, "golf").find((rate) => rate.course === round.course && rate.season === season.season);
  if (!row) {
    errors.push(issue("missing_golf_rate", `No golf price is listed for ${round.course || "the selected course"} in ${season.season}.`, `rounds.${roundIndex}.course`));
    return null;
  }
  const costUnit = amountMinor(row.cost_per_round, `${row.course} ${season.season} cost`, errors, "cost_per_round");
  const sellUnit = amountMinor(row.sell_per_round, `${row.course} ${season.season} sell price`, errors, "sell_per_round");
  if (costUnit === null || sellUnit === null) return null;
  const costSource = costUnit * players;
  const sellSource = sellUnit * players;
  if (!Number.isSafeInteger(costSource) || !Number.isSafeInteger(sellSource)) {
    errors.push(issue("amount_overflow", `Golf round ${roundIndex + 1} exceeds the safe price range.`));
    return null;
  }
  const costGBP = toGBP(costSource, row.currency, data, errors, "currency", row.course);
  const sellGBP = toGBP(sellSource, row.currency, data, errors, "currency", row.course);
  const unitPriceGBP = toGBP(sellUnit, row.currency, data, errors, "currency", row.course);
  if (costGBP === null || sellGBP === null || unitPriceGBP === null) return null;
  return {
    row,
    players,
    line: makeLine({
      type: "golf",
      description: `${round.course}, ${round.date}: ${players} player${players === 1 ? "" : "s"} x ${round.course} round`,
      quantity: players,
      unitPriceGBP,
      totalSellGBP: sellGBP,
      totalCostGBP: costGBP,
      currency: row.currency,
      field: `rounds.${roundIndex}`,
      details: { course: round.course, date: round.date, players, season: season.season }
    })
  };
}

function applyFreePlaceOffers({ data, inputs, roundResults, lines, errors }) {
  const offers = records(data, "offers").filter((offer) => offer.type === "free_place");
  for (const { result, round, roundIndex } of roundResults) {
    for (const offer of offers) {
      if (offer.hotel_or_course !== "ALL" && offer.hotel_or_course !== round.course) continue;
      if (round.date < offer.valid_from || round.date > offer.valid_to) continue;
      const paidPlayers = Number(offer.value_1);
      if (!Number.isSafeInteger(paidPlayers) || paidPlayers < 1) {
        errors.push(issue("invalid_offer", `The free-place rule for "${offer.name}" must have a positive player count.`, "offers"));
        continue;
      }
      const freePlayers = Math.floor(result.players / (paidPlayers + 1));
      if (!freePlayers) continue;
      let sellDiscount = appliesTo(offer, "sell")
        ? toGBP(Number(result.row.sell_per_round) ? parseMinorUnits(result.row.sell_per_round) * freePlayers : 0, result.row.currency, data, errors, "offers", offer.name) ?? 0
        : 0;
      let costDiscount = appliesTo(offer, "cost")
        ? toGBP(parseMinorUnits(result.row.cost_per_round) * freePlayers, result.row.currency, data, errors, "offers", offer.name) ?? 0
        : 0;
      sellDiscount = Math.min(sellDiscount, Math.max(0, result.line.totalSellGBP - (result.discountedSell || 0)));
      costDiscount = Math.min(costDiscount, Math.max(0, result.line.totalCostGBP - (result.discountedCost || 0)));
      result.discountedSell = (result.discountedSell || 0) + sellDiscount;
      result.discountedCost = (result.discountedCost || 0) + costDiscount;
      lines.push(makeLine({
        type: "discount",
        description: `${offer.name}: ${freePlayers} complimentary golf place${freePlayers === 1 ? "" : "s"} for ${round.course}`,
        quantity: freePlayers,
        unitPriceGBP: -sellDiscount,
        totalSellGBP: -sellDiscount,
        totalCostGBP: -costDiscount,
        field: `rounds.${roundIndex}`,
        internalOnly: sellDiscount === 0,
        details: { offerId: offer.offer_id, course: round.course }
      }));
    }
  }
}

function priceTransfers({ data, inputs, errors }) {
  const lines = [];
  inputs.transfers.forEach((transfer, index) => {
    const passengers = whole(transfer.passengers, `Transfer ${index + 1} passengers`, errors, { minimum: 1, field: `transfers.${index}.passengers` });
    if (passengers === null) return;
    const combination = findTransferCombination(data, transfer.route, passengers, errors, index);
    if (!combination) return;
    const legs = transfer.return ? 2 : 1;
    const sell = combination.sell * legs;
    const cost = combination.cost * legs;
    if (!Number.isSafeInteger(sell) || !Number.isSafeInteger(cost)) {
      errors.push(issue("amount_overflow", `Transfer ${index + 1} exceeds the safe price range.`));
      return;
    }
    const vehicles = combination.vehicles.map((vehicle) => `${vehicle.name} (${vehicle.passengers})`).join(" + ");
    lines.push(makeLine({
      type: "transfer",
      description: `${transfer.route}: ${vehicles}, ${legs} leg${legs === 1 ? "" : "s"}`,
      quantity: legs,
      unitPriceGBP: combination.sell,
      totalSellGBP: sell,
      totalCostGBP: cost,
      field: `transfers.${index}`,
      details: { route: transfer.route, passengers, legs, vehicles: combination.vehicles }
    }));
  });
  return lines;
}

function priceExtras({ data, inputs, stayNights, errors }) {
  const lines = [];
  const rounds = inputs.rounds || [];
  const roomCount = (inputs.roomLines || []).reduce((total, room) => total + (Number(room.rooms) || 0), 0);
  const automatic = {
    per_person: Number(inputs.travellers) || 0,
    per_player_round: rounds.reduce((total, round) => total + (Number(round.players) || 0), 0),
    per_buggy_round: rounds.reduce((total, round) => total + Math.ceil((Number(round.players) || 0) / 2), 0),
    per_room_night: roomCount * stayNights.length,
    per_booking: 1
  };
  for (const [index, extra] of records(data, "extras").entries()) {
    const override = inputs.extraQuantities?.[extra.item];
    const quantity = whole(
      override === undefined || override === null || override === "" ? automatic[extra.unit] ?? 0 : override,
      `${extra.item} quantity`,
      errors,
      { minimum: 0, field: `extras.${index}.quantity` }
    );
    if (quantity === null || quantity === 0) continue;
    const costUnit = amountMinor(extra.cost, `${extra.item} cost`, errors, "cost");
    const sellUnit = amountMinor(extra.sell, `${extra.item} sell price`, errors, "sell");
    if (costUnit === null || sellUnit === null) continue;
    const sourceCost = costUnit * quantity;
    const sourceSell = sellUnit * quantity;
    if (!Number.isSafeInteger(sourceCost) || !Number.isSafeInteger(sourceSell)) {
      errors.push(issue("amount_overflow", `${extra.item} exceeds the safe price range.`));
      continue;
    }
    const costGBP = toGBP(sourceCost, extra.currency, data, errors, "currency", extra.item);
    const sellGBP = toGBP(sourceSell, extra.currency, data, errors, "currency", extra.item);
    const unitPriceGBP = toGBP(sellUnit, extra.currency, data, errors, "currency", extra.item);
    if (costGBP === null || sellGBP === null || unitPriceGBP === null) continue;
    lines.push(makeLine({
      type: "extra",
      description: `${extra.item} (${extra.unit.replaceAll("_", " ")})`,
      quantity,
      unitPriceGBP,
      totalSellGBP: sellGBP,
      totalCostGBP: costGBP,
      currency: extra.currency,
      field: `extras.${index}`,
      details: { item: extra.item, unit: extra.unit, automaticQuantity: automatic[extra.unit] ?? 0, overridden: override !== undefined && override !== null && override !== "" }
    }));
  }
  return lines;
}

function settingsNumber(settings, key, fallback) {
  const value = settings[key] ?? fallback;
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
}

export function calculateQuote(data, inputs) {
  const errors = [];
  const warnings = [];
  const settings = settingsMap(data);
  const checkIn = inputs.checkIn || "";
  const checkOut = inputs.checkOut || "";
  const quoteDate = inputs.quoteDate || "";
  const travellers = whole(inputs.travellers, "Number of travellers", errors, { minimum: 1, field: "travellers" });
  const golfers = whole(inputs.golfers, "Number of golfers", errors, { minimum: 0, field: "golfers" });
  if (!String(inputs.clientName || "").trim()) errors.push(issue("missing_client", "Enter the client name.", "clientName"));
  if (!isISODate(quoteDate)) errors.push(issue("invalid_quote_date", "Enter a valid quote date.", "quoteDate"));
  if (!isISODate(checkIn)) errors.push(issue("invalid_check_in", "Enter a valid check-in date.", "checkIn"));
  if (!isISODate(checkOut)) errors.push(issue("invalid_check_out", "Enter a valid check-out date.", "checkOut"));
  if (isISODate(checkIn) && isISODate(checkOut) && checkOut <= checkIn) {
    errors.push(issue("invalid_stay", "Check-out must be after check-in.", "checkOut"));
  }
  if (travellers !== null && golfers !== null && golfers > travellers) {
    errors.push(issue("golfers_exceed_travellers", "The number of golfers cannot exceed the number of travellers.", "golfers"));
  }
  if (isISODate(quoteDate) && isISODate(checkIn) && quoteDate > checkIn) {
    warnings.push(issue("quote_after_travel", "The quote date is after check-in.", "quoteDate"));
  }

  const stayNights = isISODate(checkIn) && isISODate(checkOut) && checkOut > checkIn
    ? datesBetween(checkIn, checkOut)
    : [];
  const roomLines = Array.isArray(inputs.roomLines) ? inputs.roomLines : [];
  const rounds = Array.isArray(inputs.rounds) ? inputs.rounds : [];
  const transfers = Array.isArray(inputs.transfers) ? inputs.transfers : [];
  const normalizedInputs = { ...inputs, checkIn, checkOut, quoteDate, travellers, golfers, roomLines, rounds, transfers };
  const roomResults = [];
  const priceLines = [];
  let totalBeds = 0;
  let totalRooms = 0;

  if (roomLines.length === 0) errors.push(issue("no_rooms", "Add at least one room line.", "roomLines"));
  if (stayNights.length > 0) {
    for (const [index, roomLine] of roomLines.entries()) {
      const result = priceAccommodation({
        data,
        inputs: normalizedInputs,
        roomLine,
        roomIndex: index,
        nights: stayNights,
        errors
      });
      roomResults.push({ result, roomLine, roomIndex: index });
      totalBeds += (result.rooms || 0) * (result.occupancy || 0);
      totalRooms += result.rooms || 0;
      priceLines.push(...result.lines);
    }
  }
  if (travellers !== null && totalBeds < travellers) {
    errors.push(issue("not_enough_beds", `The selected rooms sleep ${totalBeds} travellers, but the booking has ${travellers}.`, "roomLines"));
  } else if (travellers !== null && totalBeds > travellers * 1.5) {
    warnings.push(issue("excess_beds", `The selected rooms sleep ${totalBeds}, which is considerably more than the ${travellers} travellers.`, "roomLines"));
  }

  if (stayNights.length > 0 && !errors.some((error) => ["invalid_stay", "invalid_check_in", "invalid_check_out"].includes(error.code))) {
    applyAccommodationOffers({
      data,
      inputs: normalizedInputs,
      roomResults,
      lines: priceLines,
      errors
    });
  }
  const golfResults = [];
  for (const [index, round] of rounds.entries()) {
    const result = priceGolfRound({ data, round, roundIndex: index, inputs: normalizedInputs, errors });
    if (!result) continue;
    golfResults.push({ result, round, roundIndex: index });
    priceLines.push(result.line);
  }
  applyFreePlaceOffers({ data, inputs: normalizedInputs, roundResults: golfResults, lines: priceLines, errors });

  priceLines.push(...priceTransfers({ data, inputs: normalizedInputs, errors }));
  priceLines.push(...priceExtras({ data, inputs: normalizedInputs, stayNights, errors }));

  for (const line of priceLines) {
    if (line.type !== "discount" && line.totalSellGBP < line.totalCostGBP) {
      warnings.push(issue("sell_below_cost", `${line.description} sells below cost.`, line.field));
    }
  }
  const totalSellGBP = safeSubtotal(priceLines, "totalSellGBP", errors);
  const totalCostGBP = safeSubtotal(priceLines, "totalCostGBP", errors);
  const profitGBP = totalSellGBP - totalCostGBP;
  const marginPercent = totalSellGBP > 0 ? profitGBP / totalSellGBP * 100 : 0;
  const markupPercent = totalCostGBP > 0 ? profitGBP / totalCostGBP * 100 : 0;
  if (totalSellGBP > 0 && marginPercent < 10) warnings.push(issue("low_margin", "The quote margin is below 10%."));

  const depositPercent = settingsNumber(settings, "deposit_percent", 30);
  const balanceWeeks = settingsNumber(settings, "balance_due_weeks_before_travel", 6);
  const validDays = settingsNumber(settings, "quote_valid_days", 14);
  let depositGBP = 0;
  try {
    if (Number.isFinite(depositPercent) && depositPercent >= 0 && depositPercent <= 100) {
      depositGBP = percentOfMinor(totalSellGBP, depositPercent);
    } else {
      errors.push(issue("invalid_setting", 'Setting "deposit_percent" must be between 0 and 100.'));
    }
  } catch {
    errors.push(issue("invalid_setting", 'Setting "deposit_percent" must be a valid percentage.'));
  }
  const balanceGBP = totalSellGBP - depositGBP;
  let balanceDueDate = null;
  let validUntil = null;
  let amountDueNowGBP = depositGBP;
  let dueImmediately = false;
  if (isISODate(checkIn)) {
    try {
      balanceDueDate = addWeeks(checkIn, -balanceWeeks);
      validUntil = isISODate(quoteDate) ? addDays(quoteDate, validDays) : null;
      if (validUntil && balanceDueDate <= addDays(quoteDate, 7)) {
        amountDueNowGBP = totalSellGBP;
        dueImmediately = true;
      }
    } catch {
      errors.push(issue("invalid_setting", "Travel payment and quote-validity terms must use whole days or weeks."));
    }
  }

  const currentDate = todayISO();
  if (isISODate(currentDate)) {
    for (const row of records(data, "fx")) {
      if (!isISODate(row.as_of)) continue;
      if (daysBetween(row.as_of, currentDate) > 30) {
        warnings.push(issue("stale_rate", `The ${row.currency} exchange rate is more than 30 days old.`, "currency"));
      }
    }
  }

  return {
    inputs: normalizedInputs,
    lines: priceLines,
    errors,
    warnings,
    totals: {
      totalSellGBP,
      totalCostGBP,
      profitGBP,
      marginPercent,
      markupPercent,
      depositGBP,
      balanceGBP,
      amountDueNowGBP,
      balanceDueDate,
      validUntil,
      dueImmediately
    },
    stay: { nights: stayNights.length, dates: stayNights, beds: totalBeds, rooms: totalRooms },
    dataVersion: ""
  };
}

export function calculateTransferCombination(data, route, passengers) {
  const errors = [];
  const groupSize = whole(passengers, "Transfer passengers", errors, { minimum: 1 });
  if (groupSize === null) return { combination: null, errors };
  const combination = findTransferCombination(data, route, groupSize, errors, 0);
  return { combination, errors };
}

export function seasonForDate(data, date) {
  return seasonOn(data, date);
}

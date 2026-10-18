import { dataVersion, loadData, records, settingsMap, validateData } from "./data.js";
import { addDays, daysBetween, formatDate, isISODate, todayISO } from "./dates.js";
import { generateInvoicePdf } from "./invoice.js";
import { formatGBP } from "./money.js";
import { calculateQuote } from "./pricing.js";
import { getQuote, saveQuote } from "./storage.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STATUS_TEXT = { Draft: "Draft", Sent: "Sent", Confirmed: "Confirmed", Lost: "Lost" };
const state = {
  data: null,
  issues: [],
  settings: {},
  quoteId: null,
  quoteStatus: "Draft",
  lastResult: null
};
let dynamicFieldId = 0;

function option(value, label = value) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function showNotice(text, kind = "info") {
  const notice = $("#notice");
  notice.hidden = !text;
  notice.className = `notice ${kind}`;
  notice.textContent = text || "";
}

function renderDataCheck() {
  const root = $("#data-check");
  root.replaceChildren();
  const details = document.createElement("details");
  details.open = state.issues.some((item) => item.severity === "error");
  const summary = document.createElement("summary");
  const errorCount = state.issues.filter((item) => item.severity === "error").length;
  const warningCount = state.issues.filter((item) => item.severity === "warning").length;
  summary.textContent = errorCount || warningCount
    ? `Data check: ${errorCount} problem${errorCount === 1 ? "" : "s"}${warningCount ? `, ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`
    : "Data check: all pricing files look good";
  details.append(summary);
  if (state.issues.length === 0) {
    const note = document.createElement("p");
    note.textContent = "All eight CSV files loaded and passed the required checks.";
    details.append(note);
  } else {
    const list = document.createElement("ul");
    for (const issue of state.issues) {
      const item = document.createElement("li");
      const location = `${issue.file}${issue.row === "—" ? "" : `, row ${issue.row}`}`;
      item.textContent = `${issue.severity === "error" ? "Error" : "Warning"}: ${location}: ${issue.message}`;
      list.append(item);
    }
    details.append(list);
  }
  root.append(details);
}

function roomRates(roomType) {
  return records(state.data, "hotels").filter((row) =>
    row.hotel === $("#hotel").value && row.room_type === roomType
  );
}

function refreshRoomChoice(select, requestedValue = select.value) {
  const types = [...new Set(records(state.data, "hotels")
    .filter((row) => row.hotel === $("#hotel").value)
    .map((row) => row.room_type))];
  select.replaceChildren(option("", "Choose a room"));
  for (const type of types) select.append(option(type));
  if (types.includes(requestedValue)) select.value = requestedValue;
}

function renderRoomLine(initial = {}) {
  const template = $("#room-line-template");
  const row = template.content.firstElementChild.cloneNode(true);
  const type = $(".room-type", row);
  const occupancy = $(".room-occupancy", row);
  const rooms = $(".room-count", row);
  $(".room-count-label", row).htmlFor = rooms.id = `room-count-${dynamicFieldId + 1}`;
  const board = $(".room-board", row);
  refreshRoomChoice(type, initial.roomType || "");
  dynamicFieldId += 1;
  type.id = `room-type-${dynamicFieldId}`;
  $(".room-type-label", row).htmlFor = type.id;
  occupancy.id = `room-occupancy-${dynamicFieldId}`;
  $(".room-occupancy-label", row).htmlFor = occupancy.id;
  $(".room-type-error", row).id = `room-type-error-${dynamicFieldId}`;
  $(".room-occupancy-error", row).id = `room-occupancy-error-${dynamicFieldId}`;
  $(".room-count-error", row).id = `room-count-error-${dynamicFieldId}`;
  type.setAttribute("aria-describedby", $(".room-type-error", row).id);
  occupancy.setAttribute("aria-describedby", $(".room-occupancy-error", row).id);
  rooms.setAttribute("aria-describedby", $(".room-count-error", row).id);
  $(".room-count-label", row).htmlFor = rooms.id;
  if (Number.isInteger(Number(initial.occupancy)) && Number(initial.occupancy) > 0) occupancy.value = String(initial.occupancy);
  if (Number.isInteger(Number(initial.rooms)) && Number(initial.rooms) > 0) rooms.value = String(initial.rooms);

  function updateRoomMeta() {
    const rates = roomRates(type.value);
    const max = Math.max(0, ...rates.map((rate) => Number(rate.max_occupancy) || 0));
    const previous = Number(occupancy.value) || 1;
    occupancy.replaceChildren();
    for (let number = 1; number <= Math.max(1, Math.min(2, max)); number += 1) occupancy.append(option(String(number), `${number} person${number === 1 ? "" : "s"}`));
    occupancy.value = String(Math.min(previous, Math.max(1, Math.min(2, max))));
    board.textContent = rates[0]?.board_basis || "—";
    updateQuote();
  }
  type.addEventListener("change", updateRoomMeta);
  occupancy.addEventListener("change", updateQuote);
  rooms.addEventListener("input", updateQuote);
  $(".remove-line", row).addEventListener("click", () => {
    row.remove();
    updateQuote();
  });
  updateRoomMeta();
  $("#room-lines").append(row);
  updateQuote();
  return row;
}

function renderRound(initial = {}) {
  const row = $("#round-template").content.firstElementChild.cloneNode(true);
  const course = $(".round-course", row);
  course.append(option("", "Choose a course"));
  for (const name of [...new Set(records(state.data, "golf").map((item) => item.course))]) course.append(option(name));
  course.value = initial.course || "";
  dynamicFieldId += 1;
  course.id = `round-course-${dynamicFieldId}`;
  $(".round-course-label", row).htmlFor = course.id;
  const date = $(".round-date", row);
  date.id = `round-date-${dynamicFieldId}`;
  $(".round-date-label", row).htmlFor = date.id;
  const players = $(".round-players", row);
  players.id = `round-players-${dynamicFieldId}`;
  $(".round-players-label", row).htmlFor = players.id;
  $(".round-course-error", row).id = `round-course-error-${dynamicFieldId}`;
  $(".round-date-error", row).id = `round-date-error-${dynamicFieldId}`;
  $(".round-players-error", row).id = `round-players-error-${dynamicFieldId}`;
  course.setAttribute("aria-describedby", $(".round-course-error", row).id);
  date.setAttribute("aria-describedby", $(".round-date-error", row).id);
  players.setAttribute("aria-describedby", $(".round-players-error", row).id);
  date.value = initial.date || "";
  players.value = initial.players ?? $("#golfers").value;
  for (const control of $$("select, input", row)) control.addEventListener("input", updateQuote);
  $(".remove-line", row).addEventListener("click", () => {
    row.remove();
    updateQuote();
  });
  $("#round-lines").append(row);
  updateQuote();
  return row;
}

function renderTransfer(initial = {}) {
  const row = $("#transfer-template").content.firstElementChild.cloneNode(true);
  const route = $(".transfer-route", row);
  route.append(option("", "Choose a route"));
  for (const name of [...new Set(records(state.data, "transfers").map((item) => item.route))]) route.append(option(name));
  route.value = initial.route || "";
  dynamicFieldId += 1;
  route.id = `transfer-route-${dynamicFieldId}`;
  $(".transfer-route-label", row).htmlFor = route.id;
  const passengers = $(".transfer-passengers", row);
  passengers.id = `transfer-passengers-${dynamicFieldId}`;
  $(".transfer-passengers-label", row).htmlFor = passengers.id;
  $(".transfer-route-error", row).id = `transfer-route-error-${dynamicFieldId}`;
  $(".transfer-passengers-error", row).id = `transfer-passengers-error-${dynamicFieldId}`;
  route.setAttribute("aria-describedby", $(".transfer-route-error", row).id);
  passengers.setAttribute("aria-describedby", $(".transfer-passengers-error", row).id);
  passengers.value = initial.passengers ?? $("#travellers").value;
  $(".transfer-return", row).checked = Boolean(initial.return);
  for (const control of $$("select, input", row)) control.addEventListener("input", updateQuote);
  $(".remove-line", row).addEventListener("click", () => {
    row.remove();
    updateQuote();
  });
  $("#transfer-lines").append(row);
  updateQuote();
}

function autoExtraQuantity(unit, inputs) {
  const roomCount = inputs.roomLines.reduce((total, line) => total + (Number(line.rooms) || 0), 0);
  return {
    per_person: Number(inputs.travellers) || 0,
    per_player_round: inputs.rounds.reduce((total, round) => total + (Number(round.players) || 0), 0),
    per_buggy_round: inputs.rounds.reduce((total, round) => total + Math.ceil((Number(round.players) || 0) / 2), 0),
    per_room_night: roomCount * (isISODate(inputs.checkIn) && isISODate(inputs.checkOut) && inputs.checkOut > inputs.checkIn
      ? daysBetween(inputs.checkIn, inputs.checkOut)
      : 0),
    per_booking: 1
  }[unit] ?? 0;
}

function readFormInputs() {
  const roomLines = $$(".room-line", $("#room-lines")).map((row) => ({
    roomType: $(".room-type", row).value,
    occupancy: $(".room-occupancy", row).value,
    rooms: $(".room-count", row).value
  }));
  const rounds = $$(".round-line", $("#round-lines")).map((row) => ({
    course: $(".round-course", row).value,
    date: $(".round-date", row).value,
    players: $(".round-players", row).value
  }));
  const transfers = $$(".transfer-line", $("#transfer-lines")).map((row) => ({
    route: $(".transfer-route", row).value,
    passengers: $(".transfer-passengers", row).value,
    return: $(".transfer-return", row).checked
  }));
  const extraQuantities = {};
  $$(".extra-quantity").forEach((input) => {
    if (input.value !== "") extraQuantities[input.dataset.item] = input.value;
  });
  return {
    clientName: $("#client-name").value,
    email: $("#client-email").value,
    phone: $("#client-phone").value,
    leadTraveller: $("#lead-traveller").value,
    quoteDate: $("#quote-date").value,
    internalNotes: $("#internal-notes").value,
    travellers: $("#travellers").value,
    golfers: $("#golfers").value,
    hotel: $("#hotel").value,
    checkIn: $("#check-in").value,
    checkOut: $("#check-out").value,
    roomLines,
    rounds,
    transfers,
    extraQuantities
  };
}

function renderExtras() {
  const root = $("#extra-lines");
  root.replaceChildren();
  for (const [index, extra] of records(state.data, "extras").entries()) {
    const row = $("#extra-template").content.firstElementChild.cloneNode(true);
    $(".extra-name", row).textContent = extra.item;
    $(".extra-unit", row).textContent = extra.unit.replaceAll("_", " ");
    const input = $(".extra-quantity", row);
    input.dataset.item = extra.item;
    input.id = `extra-${index}`;
    input.placeholder = "Auto";
    const error = document.createElement("span");
    error.className = "field-error extra-error";
    error.hidden = true;
    error.id = `extra-error-${index}`;
    input.setAttribute("aria-describedby", error.id);
    $("label", row).htmlFor = input.id;
    input.addEventListener("input", updateQuote);
    row.append(error);
    root.append(row);
  }
}

function renderHotels(selected = "") {
  const select = $("#hotel");
  select.replaceChildren(option("", "Choose a hotel"));
  for (const hotel of [...new Set(records(state.data, "hotels").map((row) => row.hotel))]) select.append(option(hotel));
  if (selected && [...select.options].some((item) => item.value === selected)) select.value = selected;
}

function setFieldErrors(errors) {
  $$(".field-error").forEach((element) => {
    element.textContent = "";
    element.hidden = true;
  });
  $$("[aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
  const fields = {
    clientName: "#client-name",
    quoteDate: "#quote-date",
    travellers: "#travellers",
    golfers: "#golfers",
    hotel: "#hotel",
    checkIn: "#check-in",
    checkOut: "#check-out"
  };
  for (const error of errors) {
    let target = fields[error.field];
    let messageTarget = target ? `${target}-error` : null;
    if (error.field?.startsWith("roomLines.")) {
      const [, index, field] = error.field.split(".");
      const row = $$(".room-line", $("#room-lines"))[Number(index)];
      const input = field === "occupancy" ? $(".room-occupancy", row) : field === "rooms" ? $(".room-count", row) : $(".room-type", row);
      target = input ? `#${input.id}` : null;
      messageTarget = input?.closest(".field")?.querySelector(".field-error") || null;
    } else if (error.field === "roomLines") {
      messageTarget = $("#room-lines-error");
    } else if (error.field?.startsWith("rounds.")) {
      const [, index, field] = error.field.split(".");
      const row = $$(".round-line", $("#round-lines"))[Number(index)];
      const input = field === "players" ? $(".round-players", row) : field === "date" ? $(".round-date", row) : $(".round-course", row);
      target = input ? `#${input.id}` : null;
      messageTarget = input?.closest(".field")?.querySelector(".field-error") || null;
    } else if (error.field?.startsWith("transfers.")) {
      const [, index, field] = error.field.split(".");
      const row = $$(".transfer-line", $("#transfer-lines"))[Number(index)];
      const input = field === "passengers" ? $(".transfer-passengers", row) : $(".transfer-route", row);
      target = input ? `#${input.id}` : null;
      messageTarget = input?.closest(".field")?.querySelector(".field-error") || null;
    } else if (error.field?.startsWith("extras.")) {
      const [, index] = error.field.split(".");
      const input = $$(".extra-quantity")[Number(index)];
      target = input ? `#${input.id}` : null;
      messageTarget = input?.closest(".extra-line")?.querySelector(".extra-error") || null;
    }
    const control = target ? $(target) : null;
    const output = typeof messageTarget === "string" ? $(messageTarget) : messageTarget;
    if (control) control.setAttribute("aria-invalid", "true");
    if (output) {
      output.hidden = false;
      output.textContent = output.textContent ? `${output.textContent} ${error.message}` : error.message;
    }
  }
}

function renderWarnings(warnings) {
  const root = $("#warning-list");
  root.replaceChildren();
  $("#warning-panel").hidden = warnings.length === 0;
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning.message;
    root.append(item);
  }
}

function renderQuote(result, inputs) {
  const root = $("#quote-lines");
  root.replaceChildren();
  const visibleLines = result.lines.filter((line) => !line.internalOnly);
  if (visibleLines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = "Your itemised quote will appear here.";
    root.append(empty);
  }
  for (const line of visibleLines) {
    const row = document.createElement("div");
    row.className = `quote-line${line.type === "discount" ? " discount-line" : ""}`;
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = line.description;
    const units = document.createElement("small");
    units.textContent = `${line.quantity} × ${formatGBP(line.unitPriceGBP)} each`;
    detail.append(name, units);
    const price = document.createElement("b");
    price.textContent = formatGBP(line.totalSellGBP);
    row.append(detail, price);
    root.append(row);
  }
  const total = result.totals.totalSellGBP;
  $("#quote-total").textContent = formatGBP(total);
  $("#mobile-total").textContent = formatGBP(total);
  $("#stay-night-count").textContent = `${result.stay.nights} night${result.stay.nights === 1 ? "" : "s"} · seasonal room prices`;
  $("#quote-client-label").textContent = inputs.clientName.trim() || "Client quote";
  $("#quote-travel-label").textContent = isISODate(inputs.checkIn) && isISODate(inputs.checkOut)
    ? `${formatDate(inputs.checkIn)} to ${formatDate(inputs.checkOut)} · ${result.stay.nights} nights`
    : "Travel dates not complete";
  $("#quote-deposit").textContent = formatGBP(result.totals.depositGBP);
  $("#quote-due-now").textContent = formatGBP(result.totals.amountDueNowGBP);
  $("#quote-balance").textContent = result.totals.dueImmediately
    ? "Full amount due immediately"
    : `${formatGBP(result.totals.balanceGBP)} due ${result.totals.balanceDueDate ? formatDate(result.totals.balanceDueDate) : "before travel"}`;
}

function renderInternal(result) {
  $("#internal-cost").textContent = formatGBP(result.totals.totalCostGBP);
  $("#internal-sell").textContent = formatGBP(result.totals.totalSellGBP);
  $("#internal-profit").textContent = formatGBP(result.totals.profitGBP);
  $("#internal-margin").textContent = `${result.totals.marginPercent.toFixed(1)}%`;
  $("#internal-markup").textContent = `${result.totals.markupPercent.toFixed(1)}%`;
}

function renderTransferChoices(result) {
  $$(".transfer-line", $("#transfer-lines")).forEach((row, index) => {
    const line = result.lines.find((item) => item.field === `transfers.${index}`);
    $(".vehicle-choice", row).textContent = line ? line.description.split(": ").slice(1).join(": ") : "";
  });
}

function updateAutomaticQuantities(inputs) {
  $$(".extra-line").forEach((row) => {
    const extra = records(state.data, "extras").find((item) => item.item === $(".extra-quantity", row).dataset.item);
    if (!extra) return;
    const automatic = autoExtraQuantity(extra.unit, inputs);
    $(".extra-auto", row).textContent = `Automatic: ${automatic}`;
    const override = inputs.extraQuantities[extra.item];
    $(".extra-effective", row).textContent = `Quantity used: ${override === undefined ? automatic : override}`;
  });
}

function updateQuote() {
  if (!state.data) return;
  const inputs = readFormInputs();
  const result = calculateQuote(state.data, inputs);
  state.lastResult = result;
  setFieldErrors(result.errors);
  renderWarnings(result.warnings);
  renderQuote(result, inputs);
  renderInternal(result);
  renderTransferChoices(result);
  updateAutomaticQuantities(inputs);
  const valid = result.errors.length === 0;
  $("#save-quote").disabled = !valid;
  $("#download-invoice").disabled = !valid;
  $("#invoice-hint").hidden = valid;
  $("#quote-error-summary").hidden = valid;
  $("#quote-error-summary").replaceChildren();
  if (!valid) {
    const heading = document.createElement("strong");
    heading.textContent = "Please fix these errors before saving or invoicing.";
    const list = document.createElement("ul");
    for (const error of result.errors) {
      const item = document.createElement("li");
      item.textContent = error.message;
      list.append(item);
    }
    $("#quote-error-summary").append(heading, list);
  }
}

function restoreInputs(inputs) {
  const direct = {
    "client-name": inputs.clientName,
    "client-email": inputs.email,
    "client-phone": inputs.phone,
    "lead-traveller": inputs.leadTraveller,
    "quote-date": inputs.quoteDate,
    "internal-notes": inputs.internalNotes,
    travellers: inputs.travellers,
    golfers: inputs.golfers,
    "check-in": inputs.checkIn,
    "check-out": inputs.checkOut
  };
  for (const [id, value] of Object.entries(direct)) if (value !== undefined) $(`#${id}`).value = value;
  renderHotels(inputs.hotel || "");
  for (const row of inputs.roomLines || []) renderRoomLine(row);
  for (const row of inputs.rounds || []) renderRound(row);
  for (const row of inputs.transfers || []) renderTransfer(row);
  for (const [item, quantity] of Object.entries(inputs.extraQuantities || {})) {
    const input = $$(".extra-quantity").find((element) => element.dataset.item === item);
    if (input && quantity !== null && quantity !== undefined) input.value = String(quantity);
  }
}

function bindForm() {
  $("#hotel").addEventListener("change", () => {
    $$(".room-line", $("#room-lines")).forEach((row) => refreshRoomChoice($(".room-type", row), ""));
    updateQuote();
  });
  $("#add-room").addEventListener("click", () => renderRoomLine());
  $("#add-round").addEventListener("click", () => renderRound());
  $("#add-transfer").addEventListener("click", () => renderTransfer());
  $("#rounds-each-day").addEventListener("click", () => {
    const course = $("#daily-course").value;
    const checkIn = $("#check-in").value;
    const checkOut = $("#check-out").value;
    if (!course || !isISODate(checkIn) || !isISODate(checkOut) || checkOut <= checkIn) {
      showNotice("Choose a course and valid stay dates first.", "error");
      return;
    }
    for (const date of Array.from({ length: Math.max(0, daysBetween(checkIn, checkOut) - 1) }, (_, index) => addDays(checkIn, index + 1))) {
      renderRound({ course, date, players: $("#golfers").value });
    }
    showNotice("One golf round was added for each full day of the stay.", "success");
  });
  for (const control of $$("input, select, textarea", $("#quote-form"))) {
    control.addEventListener("input", updateQuote);
    control.addEventListener("change", updateQuote);
  }
  $("#save-quote").addEventListener("click", () => {
    const inputs = readFormInputs();
    const result = calculateQuote(state.data, inputs);
    if (result.errors.length) return updateQuote();
    const saved = saveQuote({
      id: state.quoteId,
      inputs,
      result,
      dataVersion: dataVersion(state.data),
      status: state.quoteStatus
    });
    if (saved.error) {
      showNotice(saved.error, "error");
      return;
    }
    state.quoteId = saved.quote.id;
    history.replaceState(null, "", `index.html?quote=${encodeURIComponent(state.quoteId)}`);
    showNotice("Quote saved in this browser.", "success");
  });
  $("#download-invoice").addEventListener("click", async () => {
    updateQuote();
    if (!state.lastResult || state.lastResult.errors.length) return;
    const fallbackTab = window.open("about:blank", "_blank");
    if (fallbackTab) fallbackTab.document.body.textContent = "Preparing your pro forma invoice…";
    const saved = saveQuote({
      id: state.quoteId,
      inputs: readFormInputs(),
      result: state.lastResult,
      dataVersion: dataVersion(state.data),
      status: state.quoteStatus
    });
    if (saved.error) {
      fallbackTab?.close();
      return showNotice(saved.error, "error");
    }
    state.quoteId = saved.quote.id;
    const pdf = await generateInvoicePdf({
      quote: { ...saved.quote, result: state.lastResult },
      settings: state.settings
    });
    if (pdf.error) {
      fallbackTab?.close();
      return showNotice(pdf.error, "error");
    }
    const reserved = saveQuote({
      id: saved.quote.id,
      inputs: readFormInputs(),
      result: state.lastResult,
      dataVersion: dataVersion(state.data),
      status: state.quoteStatus,
      invoiceNumber: pdf.invoiceNumber
    });
    if (reserved.error) {
      fallbackTab?.close();
      return showNotice(`The invoice was created, but its number could not be saved with the quote: ${reserved.error}`, "error");
    }
    history.replaceState(null, "", `index.html?quote=${encodeURIComponent(state.quoteId)}`);
    const objectUrl = URL.createObjectURL(pdf.blob);
    const link = document.createElement("a");
    let openedInTab = false;
    try {
      if (!("download" in link)) throw new Error("File downloads are not supported in this browser.");
      link.href = objectUrl;
      link.download = pdf.filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      fallbackTab?.close();
    } catch {
      link.remove();
      if (fallbackTab) {
        fallbackTab.location.href = objectUrl;
        openedInTab = true;
      } else {
        const opened = window.open(objectUrl, "_blank");
        openedInTab = Boolean(opened);
      }
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    showNotice(
      openedInTab
        ? `Pro forma invoice ${pdf.invoiceNumber} opened in a new tab.`
        : `Pro forma invoice ${pdf.invoiceNumber} downloaded.`,
      "success"
    );
  });
}

function initializeDefaults() {
  const defaults = {
    "quote-date": todayISO(),
    travellers: "2",
    golfers: "2",
    "check-in": "2027-05-30",
    "check-out": "2027-06-02"
  };
  for (const [id, value] of Object.entries(defaults)) $(`#${id}`).value = value;
  renderHotels(records(state.data, "hotels")[0]?.hotel || "");
  $("#daily-course").append(option("", "Choose a course"));
  for (const course of [...new Set(records(state.data, "golf").map((row) => row.course))]) $("#daily-course").append(option(course));
  renderRoomLine({ roomType: "Double", occupancy: 2, rooms: 1 });
  renderRound({ course: "Seaside Links", date: "2027-05-31", players: 2 });
  renderRound({ course: "Pine Ridge Golf Club", date: "2027-06-01", players: 2 });
  renderExtras();
}

async function start() {
  bindForm();
  showNotice("Loading current price lists…");
  state.data = await loadData();
  state.issues = validateData(state.data);
  state.settings = settingsMap(state.data);
  renderDataCheck();
  $("#data-status").textContent = state.issues.some((item) => item.severity === "error")
    ? "Data needs attention"
    : "Pricing data ready";
  $("#data-status").classList.toggle("status-error", state.issues.some((item) => item.severity === "error"));
  if (Object.values(state.data).every((file) => !file.records.length)) {
    showNotice("No pricing data could be loaded. Run this app from GitHub Pages or a local web server, not as a file.", "error");
  } else {
    showNotice("");
  }

  const requestedId = new URLSearchParams(location.search).get("quote");
  const requested = requestedId ? getQuote(requestedId) : { quote: null, error: null };
  if (requested.error) showNotice(requested.error, "error");
  if (requested.quote) {
    state.quoteId = requested.quote.id;
    state.quoteStatus = requested.quote.status || "Draft";
    initializeDefaults();
    for (const row of $$(".room-line", $("#room-lines"))) row.remove();
    for (const row of $$(".round-line", $("#round-lines"))) row.remove();
    for (const row of $$(".transfer-line", $("#transfer-lines"))) row.remove();
    restoreInputs(requested.quote.inputs);
    $("#page-heading").textContent = "Edit saved quote";
    $("#save-quote").textContent = "Update saved quote";
    showNotice(`Editing saved ${STATUS_TEXT[state.quoteStatus] || "Draft"} quote.`, "info");
  } else {
    initializeDefaults();
    if (requestedId) showNotice("The requested saved quote was not found in this browser.", "error");
  }
  updateQuote();
}

start().catch((error) => {
  showNotice(`The quote builder could not start: ${error.message}`, "error");
  $("#data-status").textContent = "Unable to load";
});

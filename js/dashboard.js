import { formatGBP } from "./money.js";
import {
  deleteQuote,
  duplicateQuote,
  exportQuotesJSON,
  importQuotesJSON,
  loadQuotes,
  updateQuoteStatus
} from "./storage.js";

const $ = (selector, root = document) => root.querySelector(selector);
const SVG = "http://www.w3.org/2000/svg";
let quotes = [];

function notice(message, error = false) {
  const element = $("#dashboard-notice");
  element.hidden = !message;
  element.className = `notice${error ? " error" : ""}`;
  element.textContent = message || "";
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function quoteTotal(quote, field) {
  const value = quote.result?.totals?.[field];
  return Number.isSafeInteger(value) ? value : 0;
}

function confirmedQuotes() {
  return quotes.filter((quote) => quote.status === "Confirmed");
}

function groupsFor(key) {
  const groups = new Map();
  for (const quote of confirmedQuotes()) {
    const groupName = key === "hotel"
      ? quote.inputs?.hotel || "Hotel not recorded"
      : key === "course"
        ? null
        : quote.inputs?.checkIn?.slice(0, 7) || "Travel date not recorded";
    if (key === "course") {
      for (const line of quote.result?.lines || []) {
      if (line.type !== "golf" && !(line.type === "discount" && line.course)) continue;
        const name = line.course || line.description || "Course not recorded";
        const group = groups.get(name) || { name, revenue: 0, cost: 0 };
        group.revenue += Number.isSafeInteger(line.totalSellGBP) ? line.totalSellGBP : 0;
        group.cost += Number.isSafeInteger(line.totalCostGBP) ? line.totalCostGBP : 0;
        groups.set(name, group);
      }
      continue;
    }
    const group = groups.get(groupName) || { name: groupName, revenue: 0, cost: 0 };
    group.revenue += quoteTotal(quote, "totalSellGBP");
    group.cost += quoteTotal(quote, "totalCostGBP");
    groups.set(groupName, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    profit: group.revenue - group.cost,
    margin: group.revenue ? (group.revenue - group.cost) / group.revenue * 100 : 0
  })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

function appendSvgElement(svg, name, attributes = {}, text = "") {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  svg.append(element);
  return element;
}

function renderChart(host, title, data) {
  const card = document.createElement("section");
  card.className = "chart-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  card.append(heading);
  if (data.length === 0) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = "No confirmed quote data yet.";
    card.append(empty);
    host.append(card);
    return;
  }
  const width = 640;
  const rowHeight = 40;
  const top = 22;
  const labelWidth = 150;
  const revenueWidth = 255;
  const marginWidth = 120;
  const height = top + data.length * rowHeight + 9;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${title}: revenue and margin for confirmed quotes`);
  appendSvgElement(svg, "text", { x: labelWidth, y: 12, "font-size": 9, fill: "#555" }, "Revenue");
  appendSvgElement(svg, "text", { x: labelWidth + revenueWidth + 16, y: 12, "font-size": 9, fill: "#555" }, "Margin");
  appendSvgElement(svg, "rect", { x: labelWidth + 45, y: 4, width: 7, height: 7, fill: "#111" });
  appendSvgElement(svg, "rect", { x: labelWidth + revenueWidth + 58, y: 4, width: 7, height: 7, fill: "#aaa" });
  const maxRevenue = Math.max(1, ...data.map((item) => item.revenue));
  for (const [index, item] of data.entries()) {
    const y = top + index * rowHeight;
    appendSvgElement(svg, "text", { x: 0, y: y + 11, "font-size": 10, fill: "#111" }, item.name.length > 23 ? `${item.name.slice(0, 20)}...` : item.name);
    const revenueBarWidth = item.revenue ? Math.max(2, item.revenue / maxRevenue * revenueWidth) : 0;
    appendSvgElement(svg, "rect", { x: labelWidth, y: y + 2, width: revenueBarWidth, height: 10, fill: "#111" });
    appendSvgElement(svg, "text", { x: labelWidth, y: y + 25, "font-size": 9, fill: "#444" }, formatGBP(item.revenue));
    const ratio = Math.max(0, Math.min(100, item.margin));
    appendSvgElement(svg, "rect", { x: labelWidth + revenueWidth + 16, y: y + 2, width: marginWidth, height: 10, fill: "#eee" });
    appendSvgElement(svg, "rect", { x: labelWidth + revenueWidth + 16, y: y + 2, width: ratio / 100 * marginWidth, height: 10, fill: "#777" });
    appendSvgElement(svg, "text", { x: labelWidth + revenueWidth + 16, y: y + 25, "font-size": 9, fill: "#444" }, `${item.margin.toFixed(1)}% margin`);
  }
  card.append(svg);
  host.append(card);
}

function renderAnalytics() {
  const confirmed = confirmedQuotes();
  const closed = quotes.filter((quote) => quote.status === "Confirmed" || quote.status === "Lost");
  const confirmedRevenue = confirmed.reduce((total, quote) => total + quoteTotal(quote, "totalSellGBP"), 0);
  const confirmedProfit = confirmed.reduce((total, quote) => total + quoteTotal(quote, "profitGBP"), 0);
  const averageMargin = quotes.length
    ? quotes.reduce((total, quote) => total + (Number(quote.result?.totals?.marginPercent) || 0), 0) / quotes.length
    : 0;
  $("#stat-quotes").textContent = String(quotes.length);
  $("#stat-conversion").textContent = closed.length ? `${(confirmed.length / closed.length * 100).toFixed(1)}%` : "—";
  $("#stat-revenue").textContent = formatGBP(confirmedRevenue);
  $("#stat-profit").textContent = formatGBP(confirmedProfit);
  $("#stat-average-margin").textContent = `${averageMargin.toFixed(1)}%`;
  const charts = $("#analytics-charts");
  charts.replaceChildren();
  renderChart(charts, "Confirmed revenue and margin by hotel", groupsFor("hotel"));
  renderChart(charts, "Confirmed revenue and margin by course", groupsFor("course"));
  renderChart(charts, "Confirmed revenue and margin by travel month", groupsFor("month"));
}

function renderList() {
  const search = $("#quote-search").value.trim().toLowerCase();
  const statusFilter = $("#status-filter").value;
  const filtered = quotes.filter((quote) => {
    const text = `${quote.clientName} ${quote.hotel} ${quote.inputs?.leadTraveller || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!statusFilter || quote.status === statusFilter);
  });
  const body = $("#quote-table-body");
  body.replaceChildren();
  $("#quote-empty").hidden = filtered.length !== 0;
  $("#quote-table").hidden = filtered.length === 0;
  for (const quote of filtered) {
    const row = document.createElement("tr");
    const client = document.createElement("td");
    client.className = "client-cell";
    const name = document.createElement("strong");
    name.textContent = quote.clientName || "Unnamed client";
    const hotel = document.createElement("small");
    hotel.textContent = `${quote.hotel || "No hotel"} · ${quote.travelMonth || "No travel date"}`;
    client.append(name, hotel);
    row.append(client);
    const statusCell = document.createElement("td");
    statusCell.textContent = quote.status || "Draft";
    row.append(statusCell);
    const total = document.createElement("td");
    total.className = "numeric";
    total.textContent = formatGBP(quoteTotal(quote, "totalSellGBP"));
    row.append(total);
    const profit = document.createElement("td");
    profit.className = "numeric hide-mobile";
    profit.textContent = formatGBP(quoteTotal(quote, "profitGBP"));
    row.append(profit);
    const margin = document.createElement("td");
    margin.className = "numeric hide-mobile";
    margin.textContent = `${Number(quote.result?.totals?.marginPercent || 0).toFixed(1)}%`;
    row.append(margin);
    const actions = document.createElement("td");
    const controls = document.createElement("div");
    controls.className = "row-actions";
    const open = document.createElement("a");
    open.href = `./index.html?quote=${encodeURIComponent(quote.id)}`;
    open.textContent = "Open";
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.textContent = "Duplicate";
    duplicate.addEventListener("click", () => {
      const result = duplicateQuote(quote.id);
      if (result.error) notice(result.error, true);
      else refresh();
    });
    const status = document.createElement("select");
    status.setAttribute("aria-label", `Change status for ${quote.clientName || "quote"}`);
    for (const item of ["Draft", "Sent", "Confirmed", "Lost"]) status.append(new Option(item, item));
    status.value = quote.status || "Draft";
    status.addEventListener("change", () => {
      const result = updateQuoteStatus(quote.id, status.value);
      if (result.error) notice(result.error, true);
      else refresh();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!globalThis.confirm(`Delete the saved quote for ${quote.clientName || "this client"}? This cannot be undone.`)) return;
      const result = deleteQuote(quote.id);
      if (result.error) notice(result.error, true);
      else refresh();
    });
    controls.append(open, duplicate, status, remove);
    actions.append(controls);
    row.append(actions);
    body.append(row);
  }
  renderAnalytics();
}

function exportCSV() {
  const header = ["id", "client_name", "hotel", "check_in", "check_out", "status", "total_gbp", "cost_gbp", "profit_gbp", "margin_percent"];
  const rows = quotes.map((quote) => [
    quote.id,
    quote.clientName,
    quote.hotel,
    quote.inputs?.checkIn,
    quote.inputs?.checkOut,
    quote.status,
    (quoteTotal(quote, "totalSellGBP") / 100).toFixed(2),
    (quoteTotal(quote, "totalCostGBP") / 100).toFixed(2),
    (quoteTotal(quote, "profitGBP") / 100).toFixed(2),
    Number(quote.result?.totals?.marginPercent || 0).toFixed(1)
  ]);
  downloadFile("golf-quotes.csv", [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

function bind() {
  $("#quote-search").addEventListener("input", renderList);
  $("#status-filter").addEventListener("change", renderList);
  $("#export-csv").addEventListener("click", exportCSV);
  $("#export-json").addEventListener("click", () => {
    const result = exportQuotesJSON();
    if (result.error) return notice(result.error, true);
    downloadFile("golf-quotes-backup.json", result.json, "application/json");
  });
  $("#import-json-button").addEventListener("click", () => $("#import-json").click());
  $("#import-json").addEventListener("change", async () => {
    const file = $("#import-json").files[0];
    if (!file) return;
    const result = importQuotesJSON(await file.text());
    if (result.error) notice(result.error, true);
    else {
      notice(`${result.imported} quote${result.imported === 1 ? "" : "s"} imported or updated.`);
      refresh();
    }
    $("#import-json").value = "";
  });
}

function refresh() {
  const result = loadQuotes();
  quotes = result.quotes;
  if (result.error) notice(result.error, true);
  renderList();
  $("#quote-count-label").textContent = `${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}`;
}

bind();
refresh();

const QUOTES_KEY = "golf-quote-engine.quotes.v1";
const INVOICE_SEQUENCE_PREFIX = "golf-quote-engine.invoice-sequence.";
const STATUSES = new Set(["Draft", "Sent", "Confirmed", "Lost"]);

function safeStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return { storage: null, error: "Browser storage is unavailable." };
    const probe = `${QUOTES_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return { storage, error: null };
  } catch (error) {
    return { storage: null, error: `Browser storage could not be accessed: ${error.message}` };
  }
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadQuotes() {
  const { storage, error } = safeStorage();
  if (!storage) return { quotes: [], error };
  try {
    const parsed = JSON.parse(storage.getItem(QUOTES_KEY) || "[]");
    if (!Array.isArray(parsed)) return { quotes: [], error: "Saved quote data is not a list and could not be read." };
    return { quotes: parsed.filter((quote) => quote && typeof quote.id === "string"), error: null };
  } catch (parseError) {
    return { quotes: [], error: `Saved quote data could not be read: ${parseError.message}` };
  }
}

export function saveQuote({ id, inputs, result, dataVersion, status = "Draft", invoiceNumber = null }) {
  if (!STATUSES.has(status)) return { quote: null, error: "Choose a valid quote status." };
  const { quotes, error: loadError } = loadQuotes();
  if (loadError) return { quote: null, error: loadError };
  const { storage, error } = safeStorage();
  if (!storage) return { quote: null, error };
  const timestamp = new Date().toISOString();
  const previous = id ? quotes.find((quote) => quote.id === id) : null;
  const quote = {
    id: id || createId(),
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp,
    status,
    clientName: String(inputs.clientName || "").trim(),
    hotel: inputs.hotel || "",
    travelMonth: inputs.checkIn?.slice(0, 7) || "",
    inputs: structuredCloneSafe(inputs),
    result: structuredCloneSafe(result),
    dataVersion,
    invoiceNumber: invoiceNumber || previous?.invoiceNumber || null
  };
  const next = previous
    ? quotes.map((item) => item.id === id ? quote : item)
    : [quote, ...quotes];
  try {
    storage.setItem(QUOTES_KEY, JSON.stringify(next));
    return { quote, error: null };
  } catch (saveError) {
    return { quote: null, error: `Quote could not be saved: ${saveError.message}` };
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getQuote(id) {
  const { quotes, error } = loadQuotes();
  return { quote: quotes.find((quote) => quote.id === id) || null, error };
}

export function updateQuoteStatus(id, status) {
  if (!STATUSES.has(status)) return { quote: null, error: "Choose a valid quote status." };
  const { quotes, error: loadError } = loadQuotes();
  if (loadError) return { quote: null, error: loadError };
  const quote = quotes.find((item) => item.id === id);
  if (!quote) return { quote: null, error: "The saved quote no longer exists." };
  quote.status = status;
  quote.updatedAt = new Date().toISOString();
  const { storage, error } = safeStorage();
  if (!storage) return { quote: null, error };
  try {
    storage.setItem(QUOTES_KEY, JSON.stringify(quotes));
    return { quote, error: null };
  } catch (saveError) {
    return { quote: null, error: `Quote status could not be saved: ${saveError.message}` };
  }
}

export function duplicateQuote(id) {
  const { quote, error } = getQuote(id);
  if (error) return { quote: null, error };
  if (!quote) return { quote: null, error: "The saved quote no longer exists." };
  return saveQuote({
    inputs: { ...quote.inputs, clientName: `${quote.clientName} (copy)` },
    result: quote.result,
    dataVersion: quote.dataVersion,
    status: "Draft"
  });
}

export function deleteQuote(id) {
  const { quotes, error: loadError } = loadQuotes();
  if (loadError) return { deleted: false, error: loadError };
  const next = quotes.filter((quote) => quote.id !== id);
  if (next.length === quotes.length) return { deleted: false, error: "The saved quote no longer exists." };
  const { storage, error } = safeStorage();
  if (!storage) return { deleted: false, error };
  try {
    storage.setItem(QUOTES_KEY, JSON.stringify(next));
    return { deleted: true, error: null };
  } catch (saveError) {
    return { deleted: false, error: `Quote could not be deleted: ${saveError.message}` };
  }
}

export function exportQuotesJSON() {
  const result = loadQuotes();
  if (result.error) return { json: null, error: result.error };
  return {
    json: JSON.stringify({ format: "golf-quote-engine-backup", version: 1, exportedAt: new Date().toISOString(), quotes: result.quotes }, null, 2),
    error: null
  };
}

export function importQuotesJSON(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (error) {
    return { imported: 0, error: `Backup is not valid JSON: ${error.message}` };
  }
  if (!backup || !Array.isArray(backup.quotes)) return { imported: 0, error: "Backup must contain a quotes list." };
  const valid = backup.quotes.filter((quote) =>
    quote && typeof quote === "object"
    && typeof quote.id === "string"
    && quote.inputs && quote.result
    && typeof quote.clientName === "string"
  );
  if (valid.length !== backup.quotes.length) {
    return { imported: 0, error: "Backup contains one or more quotes with missing fields; nothing was imported." };
  }
  const current = loadQuotes();
  if (current.error) return { imported: 0, error: current.error };
  const merged = new Map(current.quotes.map((quote) => [quote.id, quote]));
  for (const quote of valid) {
    if (!STATUSES.has(quote.status)) quote.status = "Draft";
    merged.set(quote.id, quote);
  }
  const { storage, error } = safeStorage();
  if (!storage) return { imported: 0, error };
  try {
    storage.setItem(QUOTES_KEY, JSON.stringify([...merged.values()]));
    return { imported: valid.length, error: null };
  } catch (saveError) {
    return { imported: 0, error: `Backup could not be imported: ${saveError.message}` };
  }
}

export function nextInvoiceNumber(prefix, year) {
  const { storage, error } = safeStorage();
  if (!storage) return { invoiceNumber: null, error };
  const key = `${INVOICE_SEQUENCE_PREFIX}${year}`;
  try {
    const sequence = Number(storage.getItem(key) || "0");
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      return { invoiceNumber: null, error: "The saved invoice sequence is invalid. Do not issue an invoice until it is repaired." };
    }
    const next = sequence + 1;
    storage.setItem(key, String(next));
    return { invoiceNumber: `${prefix}-${year}-${String(next).padStart(4, "0")}`, error: null };
  } catch (saveError) {
    return { invoiceNumber: null, error: `A unique invoice number could not be reserved: ${saveError.message}` };
  }
}

export { STATUSES };

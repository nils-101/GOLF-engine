export function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

export function toDayNumber(value) {
  if (!isISODate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / 86_400_000);
}

export function fromDayNumber(dayNumber) {
  if (!Number.isSafeInteger(dayNumber)) throw new RangeError("A whole calendar day is required.");
  const date = new Date(dayNumber * 86_400_000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysBetween(start, end) {
  return toDayNumber(end) - toDayNumber(start);
}

export function addDays(value, amount) {
  if (!Number.isInteger(amount)) throw new RangeError("The number of days must be a whole number.");
  return fromDayNumber(toDayNumber(value) + amount);
}

export function addWeeks(value, amount) {
  if (!Number.isInteger(amount)) throw new RangeError("The number of weeks must be a whole number.");
  return addDays(value, amount * 7);
}

export function datesBetween(start, end) {
  const first = toDayNumber(start);
  const last = toDayNumber(end);
  if (last < first) throw new RangeError("The end date must not be before the start date.");
  return Array.from({ length: last - first }, (_, index) => fromDayNumber(first + index));
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDate(value, locale = "en-GB") {
  if (!isISODate(value)) return "Invalid date";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

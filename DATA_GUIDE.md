# Pricing data guide

All prices and examples below are fictional. Edit the CSV files in `data/` with a spreadsheet program that preserves CSV headers and UTF-8 text. Keep one header row at the top, do not add blank columns, and use real calendar dates in `YYYY-MM-DD` format. The quote builder re-reads the files whenever the page loads.

## `seasons.csv`

Defines inclusive date ranges used for each hotel night and golf round.

| Column | Meaning |
| --- | --- |
| `season` | The season label used by hotel and golf prices. A label may be used for more than one date range. |
| `start_date` | First calendar day in the season. |
| `end_date` | Last calendar day in the season. |

Example: `Peak,2027-03-01,2027-05-31`

**Common mistakes:** leaving a gap between dates, overlapping two ranges, reversing the start and end dates, or using a season label in a price file that is not listed here.

## `hotels.csv`

Each row prices one room type for one season. Accommodation prices are per room, per night.

| Column | Meaning |
| --- | --- |
| `hotel` | Hotel name. |
| `room_type` | Room or suite name at that hotel. |
| `board_basis` | Meal plan shown on the quote, such as All Inclusive or Half Board. |
| `max_occupancy` | Maximum number of people allowed in the room. |
| `season` | A season label from `seasons.csv`. |
| `cost_per_night` | Supplier cost for one room night at normal (two-person) occupancy. |
| `sell_per_night` | Client price for one room night at normal occupancy. |
| `cost_single_per_night` | Supplier cost for one room night when one person occupies it. |
| `sell_single_per_night` | Client price for one room night when one person occupies it. |
| `currency` | Currency for all prices on this row, for example `EUR`. |

Example: `Aurora Belek Resort,Double,All Inclusive,2,Peak,180,230,150,195,EUR`

Repeat the room row for every season with a price. Use the same occupancy and board basis across a room's seasonal rows. Single-occupancy prices must be supplied even if they equal the normal room price.

**Common mistakes:** entering a per-person price rather than a per-room price, forgetting the single-occupancy rates, changing a room or hotel name for just one season, or omitting a season rate needed by a stay.

## `golf.csv`

Each row prices one player for one round at one course and season.

| Column | Meaning |
| --- | --- |
| `course` | Course name. |
| `season` | A season label from `seasons.csv`. |
| `cost_per_round` | Supplier cost for one player's round. |
| `sell_per_round` | Client price for one player's round. |
| `currency` | Currency for both prices. |

Example: `Seaside Links,Peak,145,180,EUR`

**Common mistakes:** entering a group price instead of a per-player price, or using a course/season spelling that does not match its other rows.

## `transfers.csv`

Each row is one available vehicle class on a route. Prices apply to one vehicle for one one-way journey.

| Column | Meaning |
| --- | --- |
| `route` | Route name shown to the sales agent and client. |
| `vehicle` | Vehicle class, such as Car or Minivan. |
| `min_pax` | Minimum passengers assigned to this vehicle. |
| `max_pax` | Maximum passengers assigned to this vehicle. |
| `cost_per_vehicle` | Supplier cost for one vehicle on one one-way leg. |
| `sell_per_vehicle` | Client price for the same leg. |
| `currency` | Currency for both prices. |

Example: `Antalya Airport - Belek,Minivan,4,8,45,65,EUR`

**Common mistakes:** entering a return price (the app doubles one-way prices for a return), overlapping a route's passenger ranges, or leaving a gap between ranges.

## `extras.csv`

Each row defines an optional add-on and its quantity rule.

| Column | Meaning |
| --- | --- |
| `item` | Name shown on the quote. |
| `unit` | One of the five quantity codes listed below. |
| `cost` | Supplier price per unit. |
| `sell` | Client price per unit. |
| `currency` | Currency for both prices. |

Example: `Golf buggy,per_buggy_round,35,45,EUR`

Allowed unit codes:

- `per_person`: once for each traveller.
- `per_player_round`: once for every player on every round.
- `per_buggy_round`: one buggy for each pair of players on each round, rounded up.
- `per_room_night`: once for each room on each night of the stay.
- `per_booking`: once for the booking.

The quantity fields are calculated automatically. Leave an override blank to use that quantity, enter zero to exclude the item, or enter another whole number to override it.

**Common mistakes:** using prose such as `per person` instead of an exact unit code, or multiplying the price by a full group amount before entering a per-unit price.

## `offers.csv`

Each row defines a discount rule. Offer validity dates are inclusive.

| Column | Meaning |
| --- | --- |
| `offer_id` | Unique short ID; keep it unique when adding offers. |
| `name` | Discount description shown on the quote. |
| `type` | `stay_pay`, `early_booking`, or `free_place`. |
| `hotel_or_course` | Hotel or course name to match, or `ALL` where supported. |
| `valid_from` / `valid_to` | Inclusive dates for the stay check-in or golf round to qualify. |
| `value_1` / `value_2` | Numeric values interpreted by the offer type. |
| `applies_to` | `sell`, `cost`, or `both`. |

Examples:

- `STAY7PAY6,Stay 7 nights,stay_pay,Aurora Belek Resort,2027-01-01,2027-12-31,7,6,both`
- `EARLY10,Early booking,early_booking,ALL,2027-06-01,2027-12-31,10,90,sell`
- `GOLF7PLUS,One complimentary golf place,free_place,Seaside Links,2027-01-01,2027-12-31,7,0,sell`

`stay_pay` uses value 1 as the required stay nights and value 2 as paid nights. `early_booking` uses value 1 as the percentage and value 2 as the minimum days from quote date to check-in. `free_place` gives one free player for each value 1 paying players. `ALL` is accepted for free-place courses and stay-pay hotels.

**Common mistakes:** using a percentage such as `10%` rather than the number `10`, using the wrong validity dates, or misspelling `applies_to`.

## `fx.csv`

Each row gives the GBP value of one unit of a supplier currency.

| Column | Meaning |
| --- | --- |
| `currency` | Currency label used by price rows, such as `GBP`, `EUR`, or `TRY`. |
| `rate_to_gbp` | GBP received for one unit of the named currency. |
| `as_of` | Date this rate was checked, in `YYYY-MM-DD` format. |

Example: `EUR,0.85,2026-10-18`

**Common mistakes:** entering the inverse rate (EUR to GBP is `0.85`, not `1.1765`), using the same currency twice, or letting a rate's as-of date become stale.

## `settings.csv`

One row per app or invoice setting. The file uses `key,value`; keep keys exactly as listed.

| Key | Meaning |
| --- | --- |
| `company_name` | Supplier name printed on the invoice. |
| `company_address_line_1` / `_2` / `_3` | Optional supplier address lines, printed under the company name. |
| `company_email` | Supplier contact email. |
| `company_phone` | Supplier contact telephone. |
| `bank_name` | Name of the payment bank. |
| `account_name` | Bank account holder. |
| `sort_code` | UK sort code. |
| `account_number` | UK account number. |
| `iban` | International bank account number. |
| `swift` | SWIFT/BIC code. |
| `deposit_percent` | Deposit percentage, normally `30`. |
| `balance_due_weeks_before_travel` | Number of weeks before check-in that the balance is due, normally `6`. |
| `quote_valid_days` | Days a quote remains valid, normally `14`. |
| `invoice_prefix` | Prefix for locally sequential invoice IDs, normally `PF`. |
| `terms_text` | Payment and booking text printed on the invoice. |

Example: `deposit_percent,30`

**Common mistakes:** duplicating a setting key, changing a key's spelling, entering a percent sign in a numeric setting, or forgetting that company and bank values are placeholders until replaced.

## The data check

The builder checks file headers, required values, prices, calendar dates, season overlaps and gaps, duplicates, referenced seasons and currencies, transfer passenger ranges, offer types, and invoice settings. It lists problems by filename and row. Warnings such as sell prices below cost do not prevent a quote; a missing rate or seasonal price prevents the affected booking from being priced accurately.

/**
 * Number formatting for the Persian interface.
 *
 * Every number the player sees goes through here so digits and grouping are
 * consistent (۵٬۰۰۰, not 5,000).
 */

const FORMATTER = new Intl.NumberFormat('fa-IR')

export function faNumber(value: number): string {
  return FORMATTER.format(Math.round(value))
}

export function formatCoins(amount: number): string {
  return FORMATTER.format(Math.max(0, Math.round(amount)))
}

/**
 * "+۲۵" / "−۹". The sign carries the meaning, so it is never dropped.
 * A true minus sign reads better than a hyphen next to Persian digits.
 */
export function faSigned(value: number): string {
  const rounded = Math.round(value)
  return rounded >= 0 ? `+${FORMATTER.format(rounded)}` : `−${FORMATTER.format(Math.abs(rounded))}`
}

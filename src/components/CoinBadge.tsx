import { formatCoins } from '../game/format'

interface CoinBadgeProps {
  coins: number
  large?: boolean
}

export function CoinBadge({ coins, large = false }: CoinBadgeProps) {
  return (
    <span className={large ? 'coins coins--lg' : 'coins'}>
      <span aria-hidden="true">🪙</span>
      <span className="sr-only">سکه:</span>
      {formatCoins(coins)}
    </span>
  )
}

/**
 * Token/asset icon: renders the real logo when one is known (CSPR, USDC…),
 * falling back to a colored initials badge for anything else.
 */

interface Props {
  symbol: string;
  logo?: string;
  size?: number;
  className?: string;
}

const TOKEN_COLORS: Record<string, { bg: string; fg: string }> = {
  CSPR: { bg: "#1f1b0e", fg: "#f5a623" },
  USDC: { bg: "#0d1a2e", fg: "#2775ca" },
};

function tokenColor(symbol: string) {
  return TOKEN_COLORS[symbol] ?? { bg: "var(--accent-dim)", fg: "var(--accent-soft)" };
}

export function TokenIcon({ symbol, logo, size = 36, className }: Props) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={symbol}
        width={size}
        height={size}
        className={`rounded-full shrink-0 object-cover ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const { bg, fg } = tokenColor(symbol);
  return (
    <div
      className={`rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size, background: bg, color: fg, border: `1px solid ${fg}22` }}
    >
      {symbol.slice(0, 3)}
    </div>
  );
}

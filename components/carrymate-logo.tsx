import Image from "next/image";

type LogoVariant = "symbol" | "wordmark" | "full";
type LogoSize = "sm" | "md" | "lg" | "xl";

type CarryMateLogoProps = {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
};

const SIZE_MAP: Record<LogoSize, { symbol: string; wordmark: string; gap: string }> = {
  sm: { symbol: "h-[36px] w-[36px]", wordmark: "h-[28px] w-[120px]", gap: "gap-2" },
  md: { symbol: "h-[42px] w-[42px]", wordmark: "h-[34px] w-[150px]", gap: "gap-2.5" },
  lg: { symbol: "h-[48px] w-[48px]", wordmark: "h-[40px] w-[190px]", gap: "gap-3" },
  xl: { symbol: "h-[92px] w-[92px]", wordmark: "h-[60px] w-[280px]", gap: "gap-4" },
};

function LogoImage({
  alt,
  decorative,
  priority,
  src,
  className,
}: {
  alt: string;
  decorative: boolean;
  priority?: boolean;
  src: string;
  className: string;
}) {
  return (
    <span className={`relative block shrink-0 max-w-none overflow-visible ${className}`}>
      <Image
        src={src}
        alt={decorative ? "" : alt}
        aria-hidden={decorative ? "true" : undefined}
        fill
        priority={priority}
        sizes="100vw"
        className="object-contain"
      />
    </span>
  );
}

export function CarryMateLogo({
  variant = "full",
  size = "md",
  className = "",
  priority = false,
  decorative = false,
}: CarryMateLogoProps) {
  const sizeClass = SIZE_MAP[size];

  if (variant === "symbol") {
    return (
      <LogoImage
        src="/brand/carrymate-symbol.svg"
        alt="CarryMate"
        decorative={decorative}
        priority={priority}
        className={`${sizeClass.symbol} ${className}`.trim()}
      />
    );
  }

  if (variant === "wordmark") {
    return (
      <LogoImage
        src="/brand/carrymate-wordmark.svg"
        alt="CarryMate"
        decorative={decorative}
        priority={priority}
        className={`${sizeClass.wordmark} ${className}`.trim()}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center ${sizeClass.gap} ${className}`.trim()}
      aria-label={decorative ? undefined : "CarryMate"}
    >
      <LogoImage
        src="/brand/carrymate-symbol.svg"
        alt="CarryMate"
        decorative
        priority={priority}
        className={sizeClass.symbol}
      />
      <LogoImage
        src="/brand/carrymate-wordmark.svg"
        alt="CarryMate"
        decorative={decorative}
        priority={priority}
        className={sizeClass.wordmark}
      />
    </span>
  );
}

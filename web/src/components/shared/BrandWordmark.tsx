interface BrandWordmarkProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: {
    image: "h-[1.05em] w-[1.05em]",
    text: "text-base",
  },
  md: {
    image: "h-[1.1em] w-[1.1em]",
    text: "text-lg",
  },
  lg: {
    image: "h-[1.15em] w-[1.15em]",
    text: "text-2xl",
  },
} as const;

export function BrandWordmark({ size = "md", className = "" }: BrandWordmarkProps) {
  const classes = sizeClasses[size];

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
      <img
        src="/edge-brand/nanthai_edge_monogram_v2_transp.png"
        alt="NanthAi Edge logo"
        className={`${classes.image} shrink-0 object-contain`}
      />
      <span className={`${classes.text} font-bold tracking-tight text-foreground truncate`}>
        NanthAi<span className="text-primary">:</span><span className="text-primary">Edge</span>
      </span>
    </div>
  );
}

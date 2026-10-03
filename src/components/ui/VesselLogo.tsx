"use client";

interface Props {
  size?: number;
  glow?: boolean;
  className?: string;
}

/**
 * The Vessel mark: a droplet held inside a circular ring. The ring is the
 * deliberate link between the brand and the dashboard's radial/circular
 * charts — same geometric language throughout the product.
 */
export default function VesselLogo({ size = 40, glow = false, className = "" }: Props) {
  return (
    <div
      className={
        "relative flex items-center justify-center rounded-2xl " +
        (glow ? "shadow-glow " : "") +
        className
      }
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <defs>
          <linearGradient id="vessel-grad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E7A684" />
            <stop offset="1" stopColor="#A3644F" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="17.5" stroke="url(#vessel-grad)" strokeWidth="2" opacity="0.55" />
        <path d="M20 9c0 0-8 10.5-8 15.5a8 8 0 0 0 16 0C28 19.5 20 9 20 9Z" fill="url(#vessel-grad)" />
      </svg>
    </div>
  );
}

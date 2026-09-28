export interface BasisProps {
  /** The named binding constraint / source the reading carries (e.g. careReading). */
  readonly basis: string;
  readonly label?: string;
}

/**
 * A "why" annotation (brief §8.2): when an engine projection carries a named
 * basis or binding constraint, it must be shown alongside the reading so a
 * conclusion never arrives without its "because".
 */
export function Basis({ basis, label = "Why this is shown" }: BasisProps) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{label}:</span> {basis}
    </p>
  );
}

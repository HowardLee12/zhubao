"use client";

import { useState } from "react";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);

    // Only push to parent if it's a valid number
    if (raw !== "" && raw !== "-" && !isNaN(Number(raw))) {
      onChange(Number(raw));
    }
  };

  const handleBlur = () => {
    // On blur, normalize: empty → 0, apply min/max
    let num = display === "" || isNaN(Number(display)) ? 0 : Number(display);
    if (min !== undefined && num < min) num = min;
    if (max !== undefined && num > max) num = max;
    setDraft(null);
    onChange(num);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={(event) => {
        setDraft(String(value));
        event.target.select();
      }}
      min={min}
      max={max}
      step={step}
      className={className}
    />
  );
}

"use client";

import { useState, useEffect } from "react";

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
  const [display, setDisplay] = useState(String(value));

  // Sync from parent when value changes externally
  useEffect(() => {
    setDisplay((prev) => {
      // Don't overwrite if user is actively editing (empty or partial input)
      if (prev === "" || prev === "-") return prev;
      // Don't overwrite if the parsed value matches (avoids cursor jump)
      if (Number(prev) === value) return prev;
      return String(value);
    });
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplay(raw);

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
    setDisplay(String(num));
    onChange(num);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={(e) => e.target.select()}
      min={min}
      max={max}
      step={step}
      className={className}
    />
  );
}

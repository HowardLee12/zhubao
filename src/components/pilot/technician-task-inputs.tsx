"use client";

import { useState } from "react";

import { PilotButton, PilotTextarea } from "./ui";
import type { ChecklistItem } from "./work-order-api";

/**
 * Field-input primitives for the technician task screen: a per-response-type
 * checklist input and a camera-capture tile. Extracted so the task-detail
 * component stays focused on flow orchestration.
 */

// The choice response types carry a `string[]` of selectable labels in
// `item.options`. Anything else (null, a non-array, non-string members) yields
// an empty option set so the input degrades to a disabled save rather than
// throwing at render time.
function toOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === "string");
}

export function ChecklistItemInput({
  item,
  disabled,
  onRespond,
  onCapture,
}: Readonly<{
  item: ChecklistItem;
  disabled: boolean;
  onRespond: (value: unknown) => void;
  onCapture: (file: File) => void;
}>) {
  const [text, setText] = useState(
    typeof item.response === "string" ? item.response : "",
  );

  if (item.responseType === "boolean") {
    return (
      <div className="mt-2 flex gap-2">
        <PilotButton
          variant={item.response === true ? "primary" : "secondary"}
          className="min-h-11 flex-1"
          disabled={disabled}
          onClick={() => onRespond(true)}
        >
          是
        </PilotButton>
        <PilotButton
          variant={item.response === false ? "primary" : "secondary"}
          className="min-h-11 flex-1"
          disabled={disabled}
          onClick={() => onRespond(false)}
        >
          否
        </PilotButton>
      </div>
    );
  }

  if (item.responseType === "photo") {
    return (
      <div className="mt-2">
        <label className="block">
          <span className="sr-only">上傳「{item.label}」照片</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onCapture(file);
              event.target.value = "";
            }}
            className="block w-full rounded-xl border border-dashed border-warm-border-strong bg-bg-warm px-3 py-3 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-soft file:px-3 file:py-2 file:text-xs file:font-bold file:text-orange-deep"
          />
        </label>
      </div>
    );
  }

  if (item.responseType === "single_choice" || item.responseType === "multi_choice") {
    return (
      <ChoiceInput
        item={item}
        options={toOptions(item.options)}
        multiple={item.responseType === "multi_choice"}
        disabled={disabled}
        onRespond={onRespond}
      />
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <PilotTextarea
        className="min-h-11"
        value={text}
        disabled={disabled}
        inputMode={item.responseType === "number" ? "decimal" : "text"}
        onChange={(event) => setText(event.target.value)}
        placeholder="輸入作答內容"
      />
      <PilotButton
        variant="secondary"
        className="min-h-11 shrink-0"
        disabled={disabled || text.trim() === ""}
        onClick={() =>
          onRespond(item.responseType === "number" ? Number(text) : text.trim())
        }
      >
        儲存
      </PilotButton>
    </div>
  );
}

// single_choice / multi_choice input rendered as selectable chips. The RPC
// (respond_to_checklist_item) accepts a bare JSON string for single_choice and a
// JSON array for multi_choice, so the two shapes are serialized differently at
// save time — matching supabase/migrations/202607190004 exactly.
function ChoiceInput({
  item,
  options,
  multiple,
  disabled,
  onRespond,
}: Readonly<{
  item: ChecklistItem;
  options: string[];
  multiple: boolean;
  disabled: boolean;
  onRespond: (value: unknown) => void;
}>) {
  const [selected, setSelected] = useState<string[]>(() => {
    if (multiple) {
      return Array.isArray(item.response)
        ? item.response.filter((value): value is string => typeof value === "string")
        : [];
    }
    return typeof item.response === "string" ? [item.response] : [];
  });

  const toggle = (option: string) => {
    setSelected((current) => {
      if (multiple) {
        return current.includes(option)
          ? current.filter((value) => value !== option)
          : [...current, option];
      }
      return current[0] === option ? [] : [option];
    });
  };

  const save = () => {
    // multi_choice -> JSON array; single_choice -> bare string.
    onRespond(multiple ? selected : selected[0]);
  };

  return (
    <div className="mt-2">
      <fieldset className="flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{`${item.label} 選項`}</legend>
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <PilotButton
              key={option}
              variant={active ? "primary" : "secondary"}
              className="min-h-11"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => toggle(option)}
            >
              {option}
            </PilotButton>
          );
        })}
      </fieldset>
      <div className="mt-2">
        <PilotButton
          variant="secondary"
          className="min-h-11"
          disabled={disabled || selected.length === 0}
          onClick={save}
        >
          儲存
        </PilotButton>
      </div>
    </div>
  );
}

export function PhotoCaptureButton({
  label,
  count,
  disabled,
  onSelect,
}: Readonly<{
  label: string;
  count: number;
  disabled: boolean;
  onSelect: (file: File) => void;
}>) {
  return (
    <label
      className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-warm-border-strong bg-white px-2 text-center transition ${
        disabled ? "opacity-50" : "hover:border-orange/50"
      }`}
    >
      <span className="text-sm font-bold text-ink-2">{label}</span>
      <span className="text-[11px] text-ink-3">
        {count > 0 ? `已 ${count} 張` : "尚未拍攝"}
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}

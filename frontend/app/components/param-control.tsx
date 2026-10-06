import { useState } from "react";
import { Input } from "./ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "./ui/input-group";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { AutomationEditor } from "./automation-editor";
import type { Param, ParamValue } from "shared/rack";
import { useRackStore } from "../stores/rack";

type NumberParam = Extract<Param, { kind: "number" }>;

// Every control in a row shares one grid so the labels, sliders and readouts
// line up down the whole node: name, slider, value, automation.
export const paramRowClassName =
  "grid grid-cols-[6.5rem_minmax(0,1fr)_4.75rem_1.5rem] items-center gap-2";

export function ParamControl({ param }: { readonly param: Param }) {
  const value = useRackStore((state) => state.values[param.id]);
  const setParamValue = useRackStore((state) => state.setParamValue);
  const set = (next: ParamValue) => setParamValue(param.id, next);
  const inputId = `${param.id}:input`;

  return (
    <div className={paramRowClassName} data-testid="param-control">
      <Label htmlFor={inputId} className="truncate text-xs font-normal">
        {param.name}
      </Label>
      {param.kind === "number" ? (
        <NumberControl
          param={param}
          inputId={inputId}
          value={typeof value === "number" ? value : param.defaultValue}
          onChange={set}
        />
      ) : param.kind === "boolean" ? (
        <Switch
          id={inputId}
          size="sm"
          className="col-span-2 justify-self-end"
          checked={value === true}
          onCheckedChange={set}
        />
      ) : param.kind === "select" ? (
        <SelectControl
          param={param}
          inputId={inputId}
          value={value ?? param.defaultValue}
          onChange={set}
        />
      ) : (
        <Input
          id={inputId}
          className="col-span-2 h-7 text-xs"
          value={typeof value === "string" ? value : param.defaultValue}
          onChange={(event) => set(event.target.value)}
        />
      )}
    </div>
  );
}

function NumberControl({
  param,
  inputId,
  value,
  onChange,
}: {
  readonly param: NumberParam;
  readonly inputId: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const ranged = param.min !== undefined && param.max !== undefined;

  return (
    <>
      {ranged ? (
        <Slider
          thumbLabel={param.name}
          min={param.min}
          max={param.max}
          step={param.step ?? 0.01}
          // The slider draws one thumb per array entry; a bare number would
          // read as a range and grow two.
          value={[value]}
          onValueChange={(next) =>
            onChange(Array.isArray(next) ? (next[0] ?? value) : next)
          }
        />
      ) : (
        // A param with no upper bound has no honest slider travel, so it gets
        // the typed value alone.
        <span aria-hidden />
      )}
      <NumberField
        id={inputId}
        value={value}
        unit={param.unit}
        min={param.min}
        max={param.max}
        step={param.step}
        onCommit={onChange}
      />
      {param.automation === undefined ? (
        <span aria-hidden />
      ) : (
        <AutomationEditor param={param} />
      )}
    </>
  );
}

// Typing goes into a draft so a half-typed "-" or "0." is not thrown away by
// the store's clamp; the value lands on Enter or when focus leaves.
export function NumberField({
  id,
  value,
  unit,
  min,
  max,
  step,
  onCommit,
}: {
  readonly id?: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const commit = () => {
    if (draft === undefined) return;
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    setDraft(undefined);
  };

  return (
    <InputGroup className="h-7">
      <InputGroupInput
        id={id}
        inputMode="decimal"
        className="px-1.5 text-right text-xs tabular-nums"
        aria-valuemin={min}
        aria-valuemax={max}
        value={draft ?? formatNumber(value, step)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(undefined);
        }}
      />
      {unit === undefined ? null : (
        <InputGroupAddon align="inline-end" className="pl-0">
          <InputGroupText className="text-xs">{unitLabel(unit)}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

function SelectControl({
  param,
  inputId,
  value,
  onChange,
}: {
  readonly param: Extract<Param, { kind: "select" }>;
  readonly inputId: string;
  readonly value: ParamValue;
  readonly onChange: (value: ParamValue) => void;
}) {
  // Options can be numbers or booleans too, but the select works in strings,
  // so each option is keyed by its text and mapped back on the way out.
  const items = param.options.map((option) => ({
    value: String(option.value),
    label: option.label ?? String(option.value),
  }));

  return (
    <Select
      items={items}
      value={String(value)}
      onValueChange={(next) => {
        const picked = param.options.find(
          (option) => String(option.value) === next,
        );
        if (picked !== undefined) onChange(picked.value);
      }}
    >
      <SelectTrigger
        id={inputId}
        size="sm"
        className="col-span-2 w-full text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} className="text-xs">
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// Cents is the one unit too long for the readout, and ¢ is how it is written
// on hardware anyway.
export const unitLabel = (unit: string) => (unit === "cents" ? "¢" : unit);

const formatNumber = (value: number, step = 0.01) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return value.toFixed(Math.min(decimals, 3));
};

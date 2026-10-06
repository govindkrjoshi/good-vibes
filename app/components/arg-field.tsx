import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import type { Method, MethodArg, ParamValue } from "../types/rack";

const placeholders: Record<MethodArg["kind"], string> = {
  note: "C4",
  time: "now",
  number: "0",
  text: "",
  boolean: "",
};

const hints: Partial<Record<MethodArg["kind"], string>> = {
  note: "A pitch like C4 or A#3, or a frequency in Hz.",
  time: "Seconds, or a musical length like 4n or 1m.",
};

export const initialArgs = (method: Method): Record<string, ParamValue> =>
  Object.fromEntries(
    method.args.map((arg) => [
      arg.name,
      arg.defaultValue ?? (arg.kind === "boolean" ? false : ""),
    ]),
  );

export function ArgField({
  id,
  arg,
  value,
  onChange,
  suffix,
}: {
  readonly id: string;
  readonly arg: MethodArg;
  readonly value: ParamValue;
  readonly onChange: (value: ParamValue) => void;
  readonly suffix?: string;
}) {
  const label = arg.name.charAt(0).toUpperCase() + arg.name.slice(1);

  if (arg.kind === "boolean") {
    return (
      <Field orientation="horizontal" className="gap-2">
        <FieldLabel htmlFor={id} className="text-xs">
          {label}
        </FieldLabel>
        <Switch
          id={id}
          size="sm"
          checked={value === true}
          onCheckedChange={onChange}
        />
      </Field>
    );
  }

  const hint = arg.description ?? hints[arg.kind];

  return (
    <Field className="gap-1">
      <FieldLabel htmlFor={id} className="text-xs">
        {label}
        {arg.optional === true ? (
          <span className="font-normal text-muted-foreground">optional</span>
        ) : null}
        {suffix === undefined ? null : (
          <span className="font-normal text-muted-foreground">{suffix}</span>
        )}
      </FieldLabel>
      <Input
        id={id}
        className="h-7 text-xs"
        inputMode={arg.kind === "number" ? "decimal" : undefined}
        required={arg.optional !== true}
        placeholder={placeholders[arg.kind]}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <FieldDescription className="text-xs">{hint}</FieldDescription>
      )}
    </Field>
  );
}

// The form holds every field as typed text; number arguments are read as
// numbers on the way out, and one that does not parse is left out so the
// method uses its own default.
export const toArgs = (
  method: Method,
  args: Record<string, ParamValue>,
): Record<string, ParamValue> =>
  Object.fromEntries(
    method.args.flatMap((arg) => {
      const value = args[arg.name];
      if (value === undefined || value === "") return [];
      if (arg.kind !== "number") return [[arg.name, value]];
      const parsed = Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? [[arg.name, parsed]] : [];
    }),
  );

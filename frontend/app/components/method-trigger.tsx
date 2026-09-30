import { useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { Switch } from "./ui/switch";
import type { Method, MethodArg, ParamValue } from "../types/rack";
import { useRackStore } from "../stores/rack";

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

const initialArgs = (method: Method): Record<string, ParamValue> =>
  Object.fromEntries(
    method.args.map((arg) => [
      arg.name,
      arg.defaultValue ?? (arg.kind === "boolean" ? false : ""),
    ]),
  );

export function MethodTrigger({ method }: { readonly method: Method }) {
  const callMethod = useRackStore((state) => state.callMethod);
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState(() => initialArgs(method));

  const missing = method.args.some(
    (arg) => arg.optional !== true && args[arg.name] === "",
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const called = callMethod(method.id, toArgs(method, args));
    if (called !== undefined) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="method-trigger"
        render={<Button variant="outline" size="sm" className="text-xs" />}
      >
        <Play data-icon="inline-start" />
        {method.name}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{method.name}</PopoverTitle>
        </PopoverHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {method.args.length === 0 ? null : (
            <FieldGroup className="gap-3">
              {method.args.map((arg) => (
                <ArgField
                  key={arg.name}
                  id={`${method.id}:${arg.name}`}
                  arg={arg}
                  value={args[arg.name] ?? ""}
                  onChange={(value) =>
                    setArgs((held) => ({ ...held, [arg.name]: value }))
                  }
                />
              ))}
            </FieldGroup>
          )}
          <Button type="submit" size="sm" disabled={missing}>
            <Play data-icon="inline-start" />
            {method.name}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ArgField({
  id,
  arg,
  value,
  onChange,
}: {
  readonly id: string;
  readonly arg: MethodArg;
  readonly value: ParamValue;
  readonly onChange: (value: ParamValue) => void;
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
const toArgs = (
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

import { useState, type FormEvent } from "react";
import { Spline, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { Separator } from "./ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Hint } from "./hint";
import { NumberField, unitLabel } from "./param-control";
import type { AutomationEvent, Param, RampMethod } from "../types/rack";
import { useRackStore } from "../stores/rack";

type NumberParam = Extract<Param, { kind: "number" }>;

const noEvents: readonly AutomationEvent[] = [];

// Short names for the Tone.js calls, and what the time field means for each:
// the two ramp-to-value calls are timed by when they finish, not start.
const methodCopy: Record<
  RampMethod,
  { readonly label: string; readonly verb: string; readonly time: string }
> = {
  setValueAtTime: { label: "Set", verb: "Set to", time: "At" },
  rampTo: { label: "Ramp", verb: "Ramp to", time: "Starting at" },
  linearRampToValueAtTime: {
    label: "Linear",
    verb: "Linear ramp to",
    time: "Ending at",
  },
  exponentialRampToValueAtTime: {
    label: "Exp",
    verb: "Exponential ramp to",
    time: "Ending at",
  },
};

export function AutomationEditor({ param }: { readonly param: NumberParam }) {
  const events = useRackStore(
    (state) => state.automations[param.id] ?? noEvents,
  );
  const removeAutomation = useRackStore((state) => state.removeAutomation);
  const label = `Automate ${param.name}`;

  return (
    <Popover>
      <Hint label={label} side="right">
        <PopoverTrigger
          data-testid="automation-trigger"
          render={
            <Button
              variant={events.length > 0 ? "secondary" : "ghost"}
              size="icon-xs"
              className="relative"
            />
          }
        >
          <Spline />
          {events.length > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-[0.6rem] leading-none text-primary-foreground tabular-nums">
              {events.length}
            </span>
          ) : null}
        </PopoverTrigger>
      </Hint>
      <PopoverContent side="right" align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>
            Schedule changes to play out once the rack runs.
          </PopoverDescription>
        </PopoverHeader>

        {events.length === 0 ? null : (
          <ol className="flex flex-col gap-1" aria-label="Scheduled changes">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-2 rounded-md bg-muted/60 py-1 pr-1 pl-2 text-xs"
              >
                <span className="flex-1">{describe(event, param.unit)}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove: ${describe(event, param.unit)}`}
                  onClick={() => removeAutomation(param.id, event.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ol>
        )}

        <Separator />
        <AutomationForm param={param} />
      </PopoverContent>
    </Popover>
  );
}

function AutomationForm({ param }: { readonly param: NumberParam }) {
  const addAutomation = useRackStore((state) => state.addAutomation);
  const current = useRackStore((state) => state.values[param.id]);
  const methods = param.automation?.methods ?? [];

  const [method, setMethod] = useState<RampMethod | undefined>(methods[0]);
  const [value, setValue] = useState(
    typeof current === "number" ? current : param.defaultValue,
  );
  const [time, setTime] = useState("");
  const [rampTime, setRampTime] = useState("");

  if (method === undefined) return null;

  const needsRampTime = method === "rampTo";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    addAutomation(param.id, {
      method,
      value,
      time: time.trim() || "0",
      ...(needsRampTime ? { rampTime: rampTime.trim() || "0.1" } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FieldGroup className="gap-3">
        <ToggleGroup
          aria-label="Change type"
          variant="outline"
          size="sm"
          spacing={0}
          className="w-full"
          value={[method]}
          onValueChange={(next) => {
            const picked = methods.find((option) => option === next[0]);
            if (picked !== undefined) setMethod(picked);
          }}
        >
          {methods.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="flex-1 text-xs"
            >
              {methodCopy[option].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div
          className={cn(
            "grid gap-2",
            needsRampTime ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <Field className="gap-1">
            <FieldLabel htmlFor={`${param.id}:auto:value`} className="text-xs">
              Value
            </FieldLabel>
            <NumberField
              id={`${param.id}:auto:value`}
              value={value}
              unit={param.unit}
              step={param.step}
              onCommit={(next) =>
                setValue(
                  Math.min(
                    param.max ?? Infinity,
                    Math.max(param.min ?? -Infinity, next),
                  ),
                )
              }
            />
          </Field>
          <Field className="gap-1">
            <FieldLabel htmlFor={`${param.id}:auto:time`} className="text-xs">
              {methodCopy[method].time}
            </FieldLabel>
            <Input
              id={`${param.id}:auto:time`}
              className="h-7 text-xs"
              placeholder="0"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
          {needsRampTime ? (
            <Field className="gap-1">
              <FieldLabel htmlFor={`${param.id}:auto:ramp`} className="text-xs">
                Over
              </FieldLabel>
              <Input
                id={`${param.id}:auto:ramp`}
                className="h-7 text-xs"
                placeholder="0.1"
                value={rampTime}
                onChange={(event) => setRampTime(event.target.value)}
              />
            </Field>
          ) : null}
        </div>
      </FieldGroup>
      <Button type="submit" size="sm">
        Add change
      </Button>
    </form>
  );
}

const describe = (event: AutomationEvent, unit?: string) => {
  const copy = methodCopy[event.method];
  const amount = `${event.value}${unit === undefined ? "" : ` ${unitLabel(unit)}`}`;
  const over = event.rampTime === undefined ? "" : ` over ${event.rampTime}`;
  return `${copy.verb} ${amount}${over}, ${copy.time.toLowerCase()} ${event.time}`;
};

import { useState, type FormEvent } from "react";
import { Play, Plus, Repeat, X } from "lucide-react";
import { Button } from "../ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../ui/field";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { ArgField, initialArgs, toArgs } from "./arg-field";
import {
  noteArg,
  timeArg,
  type Method,
  type ParamValue,
  type RackEvent,
} from "../../rack";
import { useRack } from "../../hooks/useRack";

type When = "sequence" | "loop" | "pattern" | "part";

const whenLabels: Record<When, string> = {
  sequence: "Sequence",
  loop: "Loop",
  pattern: "Pattern",
  part: "Part",
};

const whens: readonly When[] = ["sequence", "loop", "pattern", "part"];

type PatternName = Extract<RackEvent, { kind: "pattern" }>["pattern"];

const patternNames: readonly PatternName[] = [
  "up",
  "down",
  "upDown",
  "downUp",
  "alternateUp",
  "alternateDown",
  "random",
  "randomOnce",
  "randomWalk",
];

// Adds an event to a block: which of its methods it fires (the action), and
// when. The event supplies the time arg.
export function EventEditor({
  methods,
}: {
  readonly methods: readonly Method[];
}) {
  const addEvent = useRack((state) => state.addEvent);
  const [open, setOpen] = useState(false);
  const [methodId, setMethodId] = useState(methods[0]?.id);
  const [when, setWhen] = useState<When>("sequence");
  const [steps, setSteps] = useState("8");
  const [subdivision, setSubdivision] = useState("8n");
  const [every, setEvery] = useState("4n");
  const [times, setTimes] = useState("");
  const [notes, setNotes] = useState("");
  const [order, setOrder] = useState<PatternName>("up");
  const [patternEvery, setPatternEvery] = useState("8n");
  const [partSteps, setPartSteps] = useState("");
  const [loopEnd, setLoopEnd] = useState("");
  const [args, setArgs] = useState(() =>
    methods[0] === undefined ? {} : initialArgs(methods[0]),
  );

  const method = methods.find((held) => held.id === methodId) ?? methods[0];
  if (method === undefined) return null;
  const time = timeArg(method);
  const note = noteArg(method);
  // A pattern or part supplies the note with each of its values.
  const valued = when === "pattern" || when === "part";
  const shown = method.args.filter(
    (arg) => arg !== time && !(valued && arg === note),
  );

  // A sequence fills its steps with the note, so only a loop needs it fixed.
  const missing =
    (when === "pattern" && notes.trim() === "") ||
    (when === "part" && partSteps.trim() === "") ||
    shown.some(
      (arg) =>
        arg.optional !== true &&
        (when === "loop" || arg !== note) &&
        args[arg.name] === "",
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const filled = toArgs(method, args);
    const { [time?.name ?? ""]: _, ...withoutTime } = filled;

    if (when === "sequence") {
      const { [note?.name ?? ""]: voice = "C3", ...rest } = withoutTime;
      const count = Math.min(32, Math.max(1, Number.parseInt(steps) || 8));
      const added = addEvent(method.id, {
        kind: "sequence",
        args: rest,
        mute: false,
        steps: Array.from({ length: count }, () =>
          typeof voice === "number" ? voice : String(voice),
        ),
        subdivision: subdivision.trim() || "8n",
      });
      if (added !== undefined) setOpen(false);
      return;
    }

    if (when === "pattern" || when === "part") {
      const { [note?.name ?? ""]: _note, ...rest } = withoutTime;
      const added =
        when === "pattern"
          ? addEvent(method.id, {
              kind: "pattern",
              args: rest,
              mute: false,
              values: notes.split(/[\s,]+/).filter((value) => value !== ""),
              pattern: order,
              interval: patternEvery.trim() || "8n",
            })
          : addEvent(method.id, {
              kind: "part",
              args: rest,
              mute: false,
              // One "time note" pair per line; a missing note or "-" rests.
              steps: partSteps
                .split("\n")
                .map((line) => line.trim().split(/\s+/))
                .filter(([at]) => at !== undefined && at !== "")
                .map(([at = "", value]) => ({
                  time: at,
                  value: value === undefined || value === "-" ? null : value,
                })),
              ...(loopEnd.trim() === "" ? {} : { loopEnd: loopEnd.trim() }),
            });
      if (added !== undefined) setOpen(false);
      return;
    }

    const count = Number.parseInt(times);
    const interval = every.trim() || "4n";
    const added = addEvent(method.id, {
      kind: "event",
      args: withoutTime,
      mute: false,
      start: "0",
      loop: Number.isInteger(count) && count > 0 ? count : true,
      loopEnd: interval,
    });
    if (added !== undefined) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="add-event"
        aria-label="Add event"
        render={<Button variant="outline" size="sm" />}
      >
        <Plus data-icon="inline-start" />
        Add
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64">
        <PopoverHeader>
          <PopoverTitle>Add event</PopoverTitle>
        </PopoverHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field className="gap-1">
            <FieldLabel htmlFor={`${method.id}:action`} className="text-xs">
              Action
            </FieldLabel>
            <Select
              items={methods.map((held) => ({
                value: held.id,
                label: held.name,
              }))}
              value={method.id}
              onValueChange={(next) => {
                const picked = methods.find((held) => held.id === next);
                if (picked === undefined) return;
                setMethodId(picked.id);
                setArgs(initialArgs(picked));
              }}
            >
              <SelectTrigger
                id={`${method.id}:action`}
                size="sm"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {methods.map((held) => (
                    <SelectItem
                      key={held.id}
                      value={held.id}
                      className="text-xs"
                    >
                      {held.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <FieldSet className="gap-2">
            <FieldLegend variant="label" className="mb-0 text-xs">
              When
            </FieldLegend>
            <ToggleGroup
              aria-label="When"
              variant="outline"
              size="sm"
              spacing={0}
              className="w-full"
              value={[when]}
              onValueChange={(next) => {
                const picked = whens.find((option) => option === next[0]);
                if (picked !== undefined) setWhen(picked);
              }}
            >
              {whens.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={option}
                  className="flex-1 text-xs"
                >
                  {whenLabels[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {when === "pattern" ? (
              <FieldGroup className="gap-2">
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:notes`}
                    className="text-xs"
                  >
                    Notes
                  </FieldLabel>
                  <Input
                    id={`${method.id}:notes`}
                    className="h-7 text-xs"
                    placeholder="C3 E3 G3"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field className="gap-1">
                    <FieldLabel
                      htmlFor={`${method.id}:order`}
                      className="text-xs"
                    >
                      Order
                    </FieldLabel>
                    <Select
                      items={patternNames.map((name) => ({
                        value: name,
                        label: name,
                      }))}
                      value={order}
                      onValueChange={(next) => {
                        const picked = patternNames.find(
                          (name) => name === next,
                        );
                        if (picked !== undefined) setOrder(picked);
                      }}
                    >
                      <SelectTrigger
                        id={`${method.id}:order`}
                        size="sm"
                        className="w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {patternNames.map((name) => (
                            <SelectItem
                              key={name}
                              value={name}
                              className="text-xs"
                            >
                              {name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="gap-1">
                    <FieldLabel
                      htmlFor={`${method.id}:every`}
                      className="text-xs"
                    >
                      Every
                    </FieldLabel>
                    <Input
                      id={`${method.id}:every`}
                      className="h-7 text-xs"
                      placeholder="8n"
                      value={patternEvery}
                      onChange={(event) => setPatternEvery(event.target.value)}
                    />
                  </Field>
                </div>
              </FieldGroup>
            ) : when === "part" ? (
              <FieldGroup className="gap-2">
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:part-steps`}
                    className="text-xs"
                  >
                    Steps
                  </FieldLabel>
                  <Textarea
                    id={`${method.id}:part-steps`}
                    className="text-xs md:text-xs"
                    placeholder={"0:0 C3\n0:2 E3"}
                    value={partSteps}
                    onChange={(event) => setPartSteps(event.target.value)}
                  />
                </Field>
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:loop-end`}
                    className="text-xs"
                  >
                    Loop every
                  </FieldLabel>
                  <Input
                    id={`${method.id}:loop-end`}
                    className="h-7 text-xs"
                    placeholder="once"
                    value={loopEnd}
                    onChange={(event) => setLoopEnd(event.target.value)}
                  />
                </Field>
              </FieldGroup>
            ) : when === "sequence" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:steps`}
                    className="text-xs"
                  >
                    Steps
                  </FieldLabel>
                  <Input
                    id={`${method.id}:steps`}
                    type="number"
                    min={1}
                    max={32}
                    className="h-7 text-xs"
                    value={steps}
                    onChange={(event) => setSteps(event.target.value)}
                  />
                </Field>
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:every`}
                    className="text-xs"
                  >
                    Every
                  </FieldLabel>
                  <Input
                    id={`${method.id}:every`}
                    className="h-7 text-xs"
                    placeholder="8n"
                    value={subdivision}
                    onChange={(event) => setSubdivision(event.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:every`}
                    className="text-xs"
                  >
                    Every
                  </FieldLabel>
                  <Input
                    id={`${method.id}:every`}
                    className="h-7 text-xs"
                    placeholder="4n"
                    value={every}
                    onChange={(event) => setEvery(event.target.value)}
                  />
                </Field>
                <Field className="gap-1">
                  <FieldLabel
                    htmlFor={`${method.id}:times`}
                    className="text-xs"
                  >
                    Times
                  </FieldLabel>
                  <Input
                    id={`${method.id}:times`}
                    type="number"
                    min={1}
                    className="h-7 text-xs"
                    placeholder="forever"
                    value={times}
                    onChange={(event) => setTimes(event.target.value)}
                  />
                </Field>
              </div>
            )}
          </FieldSet>
          {shown.length === 0 ? null : (
            <FieldSet className="gap-2">
              <FieldLegend variant="label" className="mb-0 text-xs">
                With
              </FieldLegend>
              <FieldGroup className="gap-3">
                {shown.map((arg) => (
                  <ArgField
                    key={arg.name}
                    id={`${method.id}:schedule:${arg.name}`}
                    arg={arg}
                    value={args[arg.name] ?? ""}
                    suffix={
                      when === "sequence" && arg === note
                        ? "each step"
                        : undefined
                    }
                    onChange={(value) =>
                      setArgs((held) => ({ ...held, [arg.name]: value }))
                    }
                  />
                ))}
              </FieldGroup>
            </FieldSet>
          )}
          <Button type="submit" size="sm" disabled={missing}>
            <Repeat data-icon="inline-start" />
            Schedule
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// One scheduled event on a block's card. A sequence shows its steps to flip
// between the voice and a rest; the other kinds say how often they fire.
export function EventRow({ event }: { readonly event: RackEvent }) {
  const method = useRack((state) => state.methods[event.methodId]);
  const setEventSteps = useRack((state) => state.setEventSteps);
  const updateEvent = useRack((state) => state.updateEvent);
  const removeEvent = useRack((state) => state.removeEvent);
  const playEvent = useRack((state) => state.playEvent);
  if (method === undefined) return null;

  return (
    <li data-testid="event-row" className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Play ${method.name}`}
          onClick={() => playEvent(event.id)}
        >
          <Play />
        </Button>
        <span className="truncate">{method.name}</span>
        <span className="flex-1 truncate text-muted-foreground">
          {event.kind === "sequence" ? null : describe(event)}
        </span>
        <Switch
          size="sm"
          aria-label={`Mute ${method.name}`}
          checked={event.mute}
          onCheckedChange={(mute) => updateEvent(event.id, { mute })}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${method.name} event`}
          onClick={() => removeEvent(event.id)}
        >
          <X />
        </Button>
      </div>
      {event.kind === "sequence" ? (
        <div
          role="group"
          aria-label={`${method.name} steps`}
          className="flex flex-wrap gap-1"
        >
          {event.steps.map((step, index) => (
            <Toggle
              key={index}
              variant="outline"
              size="sm"
              aria-label={`Step ${index + 1}`}
              className="h-6 w-5 min-w-0 px-0 aria-pressed:bg-primary aria-pressed:hover:bg-primary/80"
              pressed={step !== null}
              onPressedChange={() =>
                setEventSteps(
                  event.id,
                  event.steps.map((held, at) =>
                    at !== index
                      ? held
                      : held === null
                        ? voiceOf(event, method)
                        : null,
                  ),
                )
              }
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

// What a step turned back on plays: the voice the other steps already play,
// or the note the sequence was scheduled with.
const voiceOf = (
  event: Extract<RackEvent, { kind: "sequence" }>,
  method: Method,
): string | number => {
  const held = event.steps.find((step) => step !== null);
  if (held !== undefined && held !== null) return held;
  const note: ParamValue | undefined = event.args[noteArg(method)?.name ?? ""];
  return typeof note === "string" || typeof note === "number" ? note : "C3";
};

const describe = (event: Exclude<RackEvent, { kind: "sequence" }>) => {
  switch (event.kind) {
    case "event":
      if (event.loop === false) return `at ${event.start}`;
      return `every ${event.loopEnd}${typeof event.loop === "number" ? ` × ${event.loop}` : ""}`;
    case "pattern":
      return `${event.pattern} every ${event.interval}`;
    case "part":
      return `${event.steps.length} steps${event.loopEnd === undefined ? "" : `, loop ${event.loopEnd}`}`;
  }
};

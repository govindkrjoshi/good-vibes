import type { NodeProps } from "@xyflow/react";
import { ChevronRight, Piano } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Separator } from "../ui/separator";
import { JackBay } from "../canvas/jack-bay";
import { EnvelopeCurve } from "./envelope-curve";
import { EventEditor, EventRow } from "./event-editor";
import { ParamControl } from "./param-control";
import { Readout } from "./readout";
import { rackNodeWidth, type RackNodeType } from "../../canvas";
import { useStore } from "../../stores";
import { timeArg, type Method, type Param, type ParamGroup } from "../../rack";

// A block with params or methods is played, not just wired, so it gets a
// panel of its controls. The header is the only part that drags the node:
// everything under it is a control, marked `nodrag` so React Flow leaves
// pointer gestures on sliders and fields alone.
export function RackNode({ id, data, selected }: NodeProps<RackNodeType>) {
  const paramGroup = useStore((state) => {
    const groupId = state.rack.racks[id]?.paramGroupId;
    return groupId === undefined ? undefined : state.rack.paramGroups[groupId];
  });
  const readout = useStore((state) => {
    const rack = state.rack.racks[id];
    return rack?.type === "leaf" ? rack.readout?.kind : undefined;
  });
  const methods = useStore(
    useShallow((state) =>
      (state.rack.racks[id]?.methodIds ?? []).flatMap(
        (methodId) => state.rack.methods[methodId] ?? [],
      ),
    ),
  );
  const events = useStore(
    useShallow((state) =>
      (state.rack.racks[id]?.eventIds ?? []).flatMap(
        (eventId) => state.rack.events[eventId] ?? [],
      ),
    ),
  );

  // Only a method with a time arg can be scheduled.
  const schedulable = methods.filter(
    (method: Method) => timeArg(method) !== undefined,
  );

  return (
    <Card
      size="sm"
      data-testid="rack-node"
      style={{ width: rackNodeWidth }}
      className={cn(
        "gap-0 overflow-visible py-0 transition-shadow",
        selected ? "ring-2 ring-ring" : "shadow-sm",
      )}
    >
      <CardHeader className="flex h-11 cursor-grab flex-row items-center gap-2 not-last:border-b active:cursor-grabbing">
        <Piano aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle as="h2" className="truncate">
          {data.name}
        </CardTitle>
      </CardHeader>

      <JackBay jacks={data.jacks} />

      <CardContent className="nodrag cursor-default px-0">
        {readout === undefined ? null : <Readout rackId={id} kind={readout} />}
        {paramGroup === undefined ? null : <ParamPanel group={paramGroup} />}
      </CardContent>

      {schedulable.length === 0 ? null : (
        <CardFooter className="nodrag cursor-default flex-col items-stretch gap-2 border-t-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs text-muted-foreground">Events</h3>
            <EventEditor methods={schedulable} />
          </div>
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        </CardFooter>
      )}
    </Card>
  );
}

function ParamPanel({ group }: { readonly group: ParamGroup }) {
  const sections = Object.entries(group.groups ?? {});

  return (
    <div className="flex flex-col">
      <ParamList params={group.params} className="px-3 py-3" />
      {sections.map(([key, section]) => (
        <div key={key} className="flex flex-col">
          <Separator />
          <ParamSection name={section.name ?? key} group={section} />
        </div>
      ))}
    </div>
  );
}

function ParamSection({
  name,
  group,
}: {
  readonly name: string;
  readonly group: ParamGroup;
}) {
  const envelope = useEnvelope(group.params);
  const summary = useSectionSummary(group.params);

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
        />
        <span className="flex-1 truncate">{name}</span>
        {summary === undefined ? null : (
          <span className="truncate font-normal text-muted-foreground group-data-panel-open:hidden">
            {summary}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2.5 px-3 pb-3">
        {envelope === undefined ? null : (
          <EnvelopeCurve envelope={envelope} label={`${name} shape`} />
        )}
        <ParamList params={group.params} />
        {Object.entries(group.groups ?? {}).map(([key, child]) => (
          <div key={key} className="border-l pl-2">
            <ParamSection name={child.name ?? key} group={child} />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ParamList({
  params = [],
  className,
}: {
  readonly params: ParamGroup["params"];
  readonly className?: string;
}) {
  if (params.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {sortParams(params).map((param) => (
        <ParamControl key={param.id} param={param} />
      ))}
    </div>
  );
}

const sortParams = (params: readonly Param[]) =>
  params
    .map((param, index) => ({ param, index }))
    .sort(
      (a, b) =>
        (a.param.order ?? a.index) - (b.param.order ?? b.index) ||
        a.index - b.index,
    )
    .map(({ param }) => param);

const envelopeStages = ["attack", "decay", "sustain", "release"] as const;

// A group whose params are the four envelope stages is drawn as a curve over
// its sliders, read live from the values so the shape follows each drag. A
// param is a stage when the last step of its path is named after it.
function useEnvelope(params: ParamGroup["params"] = []) {
  return useStore(
    useShallow((state) => {
      const stages = envelopeStages.map((stage) => {
        const id = params.find((param) => param.path.at(-1) === stage)?.id;
        const value = id === undefined ? undefined : state.rack.values[id];
        return typeof value === "number" ? value : undefined;
      });
      if (stages.some((value) => value === undefined)) return undefined;
      const [attack, decay, sustain, release] = stages as number[];
      return { attack, decay, sustain, release };
    }),
  );
}

// A closed section still says what it is set to where one choice defines it,
// like an oscillator's waveform.
function useSectionSummary(params: ParamGroup["params"] = []) {
  return useStore((state) => {
    const chosen = params.flatMap((param) => {
      if (param.kind !== "select") return [];
      const value = state.rack.values[param.id] ?? param.defaultValue;
      const option = param.options.find((held) => held.value === value);
      return [option?.label ?? String(value)];
    });
    return chosen.length === 0 ? undefined : chosen.join(", ");
  });
}

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Kbd } from "../ui/kbd";

// One module the catalogue offers, with what it connects by: its inputs, the
// params a cable can drive, and its outputs.
export type CatalogueEntryView = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly plugin: string;
  readonly inputs: number;
  readonly params: number;
  readonly outputs: number;
};

// What the catalogue lists: each category's modules, in the order loaded.
export type CatalogueSection = {
  readonly category: string;
  readonly label: string;
  readonly items: readonly CatalogueEntryView[];
};

// A module's sockets as the rack panels draw them: an open ring for each
// input, a small ring for each param a cable can drive, a solid dot for each
// output, with a stroke between them for the signal passing through.
function Sockets({ item }: { readonly item: CatalogueEntryView }) {
  const ring = "size-2.5 rounded-full border-[1.5px] border-current";
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center gap-1 text-muted-foreground group-data-active/row:text-foreground"
    >
      {Array.from({ length: item.inputs }, (_, index) => (
        <span key={`in${index}`} className={ring} />
      ))}
      {Array.from({ length: item.params }, (_, index) => (
        <span
          key={`p${index}`}
          className="size-1.5 rounded-full border border-current"
        />
      ))}
      {item.inputs + item.params > 0 && item.outputs > 0 ? (
        <span className="h-[1.5px] w-3 rounded-full bg-current opacity-60" />
      ) : null}
      {Array.from({ length: item.outputs }, (_, index) => (
        <span
          key={`out${index}`}
          className="size-2.5 rounded-full bg-current"
        />
      ))}
    </span>
  );
}

const connections = (item: CatalogueEntryView) => {
  const count = (n: number, one: string) =>
    n === 0 ? [] : [`${n} ${one}${n === 1 ? "" : "s"}`];
  return [
    ...count(item.inputs, "input"),
    ...count(item.params, "patchable param"),
    ...count(item.outputs, "output"),
  ].join(", ");
};

// The toolbar's search field and the list it drops down. The field lives in
// the toolbar, so its arrow keys move between tools; the list lives outside
// it, under the whole bar, and the field drives it as a combobox: typing
// filters, up and down move the highlight, Enter adds, Escape closes.
export function useCatalogueSearch({
  catalogue,
  onPick,
  within,
}: {
  readonly catalogue: readonly CatalogueSection[];
  readonly onPick: (itemKey: string) => void;
  // What holds both the field and the list, so a press outside closes it.
  readonly within: RefObject<HTMLElement | null>;
}): {
  readonly field: ReactNode;
  readonly list: ReactNode;
  readonly focus: () => void;
} {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(catalogue[0]?.category);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!within.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, within]);

  const total = catalogue.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  const searching = query.trim() !== "";

  // A search reaches every category, each still under its own heading. A
  // name that starts with what was typed beats one that holds it, which beats
  // a description that mentions it; the best match's category comes first.
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return catalogue.filter((section) => section.category === category);
    }
    const score = (item: CatalogueEntryView) => {
      const name = item.name.toLowerCase();
      const text = `${name} ${item.description.toLowerCase()}`;
      if (!words.every((word) => text.includes(word))) return 0;
      if (name.startsWith(words[0]!)) return 3;
      return words.some((word) => name.includes(word)) ? 2 : 1;
    };
    return catalogue
      .map((section) => {
        const scored = section.items
          .map((item) => ({ item, score: score(item) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);
        return {
          ...section,
          best: scored[0]?.score ?? 0,
          items: scored.map(({ item }) => item),
        };
      })
      .filter((section) => section.items.length > 0)
      .sort((a, b) => b.best - a.best);
  }, [catalogue, category, query]);

  const rows = shown.flatMap((section) => section.items);
  const current = rows[Math.min(active, rows.length - 1)];
  const optionId = (key: string) => `${listId}-${key}`;

  // Focus goes back to the canvas, so its shortcuts work on what was added.
  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
    setQuery("");
    setActive(0);
    input.current?.blur();
  };

  const move = (by: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, active + by));
    setActive(next);
    const row = rows[next];
    if (row !== undefined) {
      listRef.current
        ?.querySelector(`[id="${optionId(row.key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (open) move(1);
      else setOpen(true);
    } else if (event.key === "ArrowUp") {
      move(-1);
    } else if (event.key === "Enter" && open && current !== undefined) {
      pick(current.key);
    } else if (event.key === "Escape") {
      // A second Escape leaves the field for the canvas.
      if (open) setOpen(false);
      else input.current?.blur();
    } else {
      return;
    }
    event.preventDefault();
    // The toolbar would take up and down as moves between its tools.
    event.stopPropagation();
  };

  const browse = (next: string) => {
    setCategory(next);
    setQuery("");
    setActive(0);
    input.current?.focus();
  };

  const field = (
    <label className="flex h-9 w-72 min-w-0 shrink items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-muted-foreground transition-colors focus-within:bg-muted focus-within:text-foreground hover:bg-muted max-sm:w-auto max-sm:flex-1 motion-reduce:transition-none">
      <Search aria-hidden className="size-4 shrink-0" />
      <ToolbarPrimitive.Input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && current ? optionId(current.key) : undefined
        }
        aria-label="Find a module"
        data-testid="catalogue-search"
        autoComplete="off"
        spellCheck={false}
        placeholder={`Find a module among ${total}`}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!within.current?.contains(event.relatedTarget)) setOpen(false);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {open ? null : <Kbd className="max-sm:hidden">/</Kbd>}
    </label>
  );

  const list = open ? (
    <div
      data-slot="catalogue-list"
      className="absolute top-full left-1/2 mt-2 flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 slide-in-from-top-1 duration-100 motion-reduce:animate-none"
    >
      {/* A phone has no room for the side list, so categories wrap above. */}
      <div className="flex flex-wrap gap-1 border-b px-2 py-1.5 sm:hidden">
        {catalogue.map((section) => (
          <button
            key={section.category}
            type="button"
            aria-pressed={!searching && section.category === category}
            onClick={() => browse(section.category)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="flex h-[min(24rem,60vh)] min-h-0">
        <nav
          aria-label="Categories"
          className="hidden w-40 shrink-0 flex-col gap-0.5 border-r p-1.5 sm:flex"
        >
          {catalogue.map((section) => {
            const selected = !searching && section.category === category;
            return (
              <button
                key={section.category}
                type="button"
                data-testid={`catalogue-${section.category}`}
                aria-current={selected ? "true" : undefined}
                onClick={() => browse(section.category)}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {section.label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {section.items.length}
                </span>
              </button>
            );
          })}
        </nav>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Modules"
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No module matches “{query.trim()}”. Try a sound, like “echo” or
              “filter”.
            </p>
          ) : (
            shown.map((section) => (
              <div
                key={section.category}
                role="group"
                aria-label={section.label}
              >
                {/* Browsing, the side list already names the category. */}
                {searching ? (
                  <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                    {section.label}
                  </div>
                ) : null}
                {section.items.map((item) => {
                  const isActive = item === current;
                  return (
                    <div
                      key={item.key}
                      id={optionId(item.key)}
                      role="option"
                      aria-selected={isActive}
                      aria-description={`${item.description} ${connections(item)}.`}
                      data-active={isActive || undefined}
                      data-testid={`catalogue-item-${item.key}`}
                      onPointerMove={() => setActive(rows.indexOf(item))}
                      // Keeps focus in the field, which drives the list.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => pick(item.key)}
                      className="group/row grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 data-active:bg-muted"
                    >
                      <span className="truncate text-[13px] font-medium">
                        {item.name}
                      </span>
                      <Sockets item={item} />
                      <span className="col-span-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full border-[1.5px] border-current" />
            in
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full border border-current" />
            patchable param
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full bg-current" />
            out
          </span>
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <Kbd>↵</Kbd> adds it
        </span>
      </div>
    </div>
  ) : null;

  return { field, list, focus: () => input.current?.focus() };
}

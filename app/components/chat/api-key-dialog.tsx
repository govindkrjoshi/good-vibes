import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";

export function ApiKeyDialog({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (key: string) => void;
  readonly onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState("");
  const titleId = useId();
  const inputId = useId();
  const descriptionId = useId();

  // A modal dialog traps focus and closes on Escape, which fires `cancel`.
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = key.trim();
    if (trimmed !== "") onSubmit(trimmed);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-sm rounded-xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10 backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 id={titleId} className="text-base font-medium">
          Connect the Good Vibes agent
        </h2>
        <Field>
          <FieldLabel htmlFor={inputId}>OpenRouter API key</FieldLabel>
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-…"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-describedby={descriptionId}
            autoFocus
          />
          <FieldDescription id={descriptionId}>
            Saved in this browser only and sent only to OpenRouter.
          </FieldDescription>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Not now
          </Button>
          <Button type="submit" disabled={key.trim() === ""}>
            Save key
          </Button>
        </div>
      </form>
    </dialog>
  );
}

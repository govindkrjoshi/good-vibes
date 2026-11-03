import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  detectProvider,
  providerOf,
  providers,
  type Credential,
  type ProviderId,
} from "../../agent";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

// Asks for a key and the service it is for. The service follows the key's
// prefix as it is typed, until the user picks one by hand.
export function ApiKeyDialog({
  initialProvider = "openrouter",
  onSubmit,
  onCancel,
}: {
  readonly initialProvider?: ProviderId;
  readonly onSubmit: (credential: Credential) => void;
  readonly onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState("");
  const [picked, setPicked] = useState<ProviderId | undefined>(undefined);
  const provider = picked ?? detectProvider(key) ?? initialProvider;
  const { label, placeholder } = providerOf(provider);
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
    if (trimmed !== "") onSubmit({ provider, key: trimmed });
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
        <ToggleGroup
          aria-label="Service"
          variant="outline"
          size="sm"
          spacing={0}
          value={[provider]}
          onValueChange={(value) => {
            const [chosen] = value;
            if (chosen !== undefined) setPicked(chosen as ProviderId);
          }}
        >
          {providers.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              data-testid={`api-key-provider-${option.id}`}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Field>
          <FieldLabel htmlFor={inputId}>{label} API key</FieldLabel>
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-describedby={descriptionId}
            autoFocus
          />
          <FieldDescription id={descriptionId}>
            Saved in this browser only and sent only to {label}.
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

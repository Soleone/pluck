import { modelChoices } from "@/agent/pi";
import type { AgentCatalog, SessionModel } from "@/bridge";
import { AgentModelFields, type AgentModelChoice } from "@/components/soleone/agent";

const DEFAULT = "default";
const NO_MODELS: AgentCatalog = { models: [], settings: null, start: null };

/** Pi's models, while asked for, or why it couldn't list them. */
export type Catalog = AgentCatalog | "loading" | { error: string };

export const loaded = (catalog: Catalog) =>
  catalog !== "loading" && !("error" in catalog) ? catalog : null;

/** The model and thinking level as far as known: unset ones are what Pi starts a session with. */
type Effective = { model?: string; thinking?: string };

/** What a session with `value` runs with, when unset ones mean `fallback`. A model picked without a
 * level runs with the level Pi gives that model. */
export function effectiveModel(
  catalog: AgentCatalog,
  value: SessionModel,
  fallback: Effective,
): Effective {
  if (!value.model) return { model: fallback.model, thinking: value.thinking ?? fallback.thinking };
  const choice = modelChoices(catalog.models, catalog.settings).find(
    ({ id }) => id === value.model,
  );
  return { model: value.model, thinking: value.thinking ?? choice?.thinking };
}

/** What Pi starts a session with when pluck names no model or level. */
export const piStart = (catalog: AgentCatalog): Effective => ({
  model: catalog.start?.model,
  thinking: catalog.start?.thinking,
});

export function modelName(catalog: AgentCatalog, id: string) {
  return (
    modelChoices(catalog.models, catalog.settings).find((choice) => choice.id === id)?.name ?? id
  );
}

/**
 * Model and thinking level for sessions. The first choice leaves the model unset, which means
 * `fallback`, named by `fallbackLabel`; a model's marked level leaves the level unset. Disabled
 * until Pi has listed its models.
 */
export function ModelPicker({
  catalog,
  value,
  fallback,
  fallbackLabel,
  onChange,
}: {
  catalog: Catalog;
  value: SessionModel;
  fallback: Effective;
  fallbackLabel: string;
  onChange: (value: SessionModel) => void;
}) {
  const known = loaded(catalog) ?? NO_MODELS;
  const choices = modelChoices(known.models, known.settings);
  const levelsOf = (id?: string) => choices.find((choice) => choice.id === id)?.thinkingLevels;
  const models: AgentModelChoice[] = [
    {
      id: DEFAULT,
      label: fallback.model
        ? `${fallbackLabel}: ${modelName(known, fallback.model)}`
        : fallbackLabel,
      thinkingLevels: levelsOf(fallback.model) ?? (fallback.thinking ? [fallback.thinking] : []),
      thinking: fallback.thinking ?? "",
    },
    ...choices.map((choice) => ({
      ...choice,
      label: `${choice.name} · ${choice.id.split("/")[0]}`,
    })),
  ];
  // A model Pi no longer offers, kept from pluck.toml or the settings.
  if (value.model && !levelsOf(value.model))
    models.push({
      id: value.model,
      label: value.model,
      thinkingLevels: value.thinking ? [value.thinking] : [],
      thinking: "",
    });

  return (
    <AgentModelFields
      models={models}
      model={value.model ?? DEFAULT}
      thinking={effectiveModel(known, value, fallback).thinking ?? ""}
      disabled={!loaded(catalog)}
      onChange={(id, thinking) => {
        const next = models.find((choice) => choice.id === id);
        onChange({
          model: id === DEFAULT ? null : id,
          thinking: thinking === next?.thinking ? null : thinking,
        });
      }}
    />
  );
}

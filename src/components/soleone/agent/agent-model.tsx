"use client"

import { useId } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** A model to offer, with the thinking levels it supports and the one Pi starts it with. */
export type AgentModelChoice = {
  id: string
  label: string
  thinkingLevels: string[]
  thinking: string
  disabled?: boolean
}

function Choice({ label, value, options, onChange, disabled }: {
  label: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
  disabled: boolean
}) {
  const id = useId()
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => next !== null && onChange(next)} disabled={disabled} items={options}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * Model and thinking level, side by side. The level Pi starts a model with is marked. Switching
 * models keeps a level the person picked, when the new model supports it, else takes the new
 * model's own.
 */
export function AgentModelFields({ models, model, thinking, onChange, disabled = false }: {
  models: AgentModelChoice[]
  model: string
  thinking: string
  onChange: (model: string, thinking: string) => void
  disabled?: boolean
}) {
  const current = models.find((choice) => choice.id === model)
  const levels = current?.thinkingLevels ?? [thinking]
  return (
    <div className="grid grid-cols-2 gap-3">
      <Choice
        label="Model"
        value={model}
        disabled={disabled}
        options={models.map((choice) => ({ value: choice.id, label: choice.label, disabled: choice.disabled }))}
        onChange={(next) => {
          const choice = models.find((candidate) => candidate.id === next)
          const picked = thinking !== current?.thinking && choice?.thinkingLevels.includes(thinking)
          if (choice) onChange(next, picked ? thinking : choice.thinking)
        }}
      />
      <Choice
        label="Thinking"
        value={thinking}
        disabled={disabled}
        options={levels.map((level) => ({
          value: level,
          label: level === current?.thinking ? `${level} (Pi default)` : level,
        }))}
        onChange={(next) => onChange(model, next)}
      />
    </div>
  )
}

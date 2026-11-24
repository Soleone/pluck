import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/soleone/tooltip/tooltip"
import type { AgentQuestion } from "./ask-user"

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0
const labelled = (value: unknown): value is { label: string; description?: unknown } =>
  typeof value === "object" && value !== null && "label" in value && isText(value.label)

/** The question in an `ask_user` call, which comes from the model and so may be malformed. */
export function questionOf(data: unknown): AgentQuestion | undefined {
  if (typeof data !== "object" || data === null || !("options" in data) || !Array.isArray(data.options)) return undefined
  const options = data.options.filter(labelled).map(({ label, description }) => ({
    label, description: isText(description) ? description : undefined,
  }))
  if (options.length === 0) return undefined
  const extras = "extras" in data && Array.isArray(data.extras) ? data.extras.filter(labelled) : []
  return {
    question: "question" in data && isText(data.question) ? data.question : undefined,
    options,
    extras: extras.map(({ label }) => ({ label })),
  }
}

/** Short options sit side by side; more or longer ones fold behind the default's menu. */
const fitsInline = ({ options }: AgentQuestion) =>
  options.length === 1 || (options.length <= 3 && options.every((option) => option.label.length <= 20))

/** One click on an option sends it, with the ticked extras. Locked once answered. */
export function QuestionCard({ question, locked, onAnswer }: {
  question: AgentQuestion
  locked: boolean
  onAnswer: (text: string) => void
}) {
  const [ticked, setTicked] = useState<string[]>([])
  const [first, ...rest] = question.options
  const answer = (option: string) => {
    const extras = question.extras?.map((extra) => extra.label).filter((label) => ticked.includes(label)) ?? []
    onAnswer(extras.length ? `${option}\n\nAlso: ${extras.join(", ")}` : option)
  }
  const button = (option: AgentQuestion["options"][number], primary: boolean) => {
    const node = (
      <Button key={option.label} size="sm" variant={primary ? "default" : "outline"} disabled={locked} onClick={() => answer(option.label)}>
        {option.label}
      </Button>
    )
    if (!option.description) return node
    return (
      <Tooltip key={option.label}>
        <TooltipTrigger render={node} />
        <TooltipContent>{option.description}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <div role="group" aria-label={question.question ?? "Choose how to continue"} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      {question.question && <p className="text-sm font-medium">{question.question}</p>}
      {question.extras && question.extras.length > 0 && (
        <ul className="flex flex-col gap-2">
          {question.extras.map(({ label }) => (
            <li key={label}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={ticked.includes(label)}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    setTicked((current) => checked ? [...current, label] : current.filter((each) => each !== label))
                  }
                />
                {label}
              </label>
            </li>
          ))}
        </ul>
      )}
      {fitsInline(question) ? (
        <div className="flex flex-wrap gap-2">{question.options.map((option, index) => button(option, index === 0))}</div>
      ) : (
        <ButtonGroup className="max-w-full">
          {button(first, true)}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" aria-label="Other answers" disabled={locked} />}>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-72">
              {rest.map((option) => (
                <DropdownMenuItem key={option.label} className="flex-col items-start gap-0.5" onClick={() => answer(option.label)}>
                  {option.label}
                  {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}
    </div>
  )
}

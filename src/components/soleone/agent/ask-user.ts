export type AgentQuestion = {
  question?: string
  /** One click answers. The first is the default. */
  options: { label: string; description?: string }[]
  /** Checkboxes whose labels join the chosen option's answer. */
  extras?: { label: string }[]
}

export const askUser = {
  name: "ask_user",
  description:
    "Ask the person to choose how to continue. They see the options as buttons and answer in one click; their answer arrives as their next message. Call it last in your turn, then stop.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "Short and self-contained. Leave out when your reply already asks it." },
      options: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        description: "Mutually exclusive answers, the recommended one first. Labels are short verbs like \"Build it\".",
        items: {
          type: "object",
          properties: {
            label: { type: "string", maxLength: 60 },
            description: { type: "string", maxLength: 160 },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      extras: {
        type: "array",
        maxItems: 6,
        description: "Optional additions the person can tick before choosing, like \"Add tests\".",
        items: {
          type: "object",
          properties: { label: { type: "string", maxLength: 60 } },
          required: ["label"],
          additionalProperties: false,
        },
      },
    },
    required: ["options"],
    additionalProperties: false,
  },
  /** For the system prompt. */
  prompt:
    "When the next step is the person's decision, such as whether to go ahead, which of a few approaches to take or what to include, end your turn with ask_user instead of asking in prose. Offer a single option like \"Go ahead\" when you only need a yes. The person can still type a different answer.",
} as const

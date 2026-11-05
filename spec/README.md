# pluck specification

TODO: two or three sentences on what the app is.

This spec says what the app does. It doesn't say how it is built, what is proven where, or why every decision was made; that lives in docs/.

## Reading a rule

Behavior is written as rules in tables:

| Rule         | When                              | Then                   |
| ------------ | --------------------------------- | ---------------------- |
| `theme.open` | `T` anywhere outside a text field | The theme picker opens |

- **Rule** is a stable slug, `area.behavior`. Tests put it in their title (`test("theme.open: ...")`).
- **When** is the situation or input. **Then** is the observable result, in plain present tense.
- **MUST** appears only where a rule could be misread as optional.
- A `> Why:` line follows a rule only when the reason isn't obvious.

Split into files by area (`spec/home.md`, `spec/settings.md`) once this one gets long, and link them here.

## Glossary

| Term | Meaning |
| ---- | ------- |

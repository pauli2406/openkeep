import type { KeyboardEvent } from "react";

/**
 * An Enter that means "submit". With an input method editor (Japanese, Chinese,
 * Korean and others), Enter first confirms the characters being composed; acting
 * on that one would send half a word. Safari reports it as keyCode 229 rather
 * than through `isComposing`, so both are checked.
 */
export function isEnterKey(event: KeyboardEvent<Element>) {
  return event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229;
}

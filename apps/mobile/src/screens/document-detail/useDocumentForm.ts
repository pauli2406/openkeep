import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchiveDocument } from "../../lib";
import { formToState, mergeServerForm, type MetadataForm } from "./shared";

/**
 * The inspector edits in place and a pending document is polled every few seconds,
 * so the form lives here, above the tabs, and follows the server one untouched
 * field at a time. Switching tabs keeps an edit; a poll never wipes one.
 */
export function useDocumentForm(document: ArchiveDocument | undefined) {
  const serverForm = useMemo(() => (document ? formToState(document) : null), [document]);
  const [form, setForm] = useState<MetadataForm | null>(serverForm);
  const seededFrom = useRef<MetadataForm | null>(serverForm);

  useEffect(() => {
    if (!serverForm) {
      return;
    }
    const previous = seededFrom.current;
    seededFrom.current = serverForm;
    setForm((current) =>
      previous && current ? mergeServerForm(previous, current, serverForm) : serverForm,
    );
  }, [serverForm]);

  const patchForm = useCallback((patch: Partial<MetadataForm>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const resetForm = useCallback(() => {
    setForm(serverForm);
  }, [serverForm]);

  return { form: form ?? serverForm, patchForm, resetForm };
}

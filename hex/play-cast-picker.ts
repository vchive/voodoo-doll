export type CastPickerCandidate = { id: string; label: string; button: HTMLButtonElement };
export type CastPickerOptions = {
  /** Re-read public presence and current DOM; do not retain a snapshot here. */
  getCandidates(): readonly CastPickerCandidate[];
  isEnabled(): boolean;
  onSelect(id: string): void;
};
export type CastPicker = {
  pick(event: MouseEvent, triggerId: string): void;
  close(): void;
  destroy(): void;
};

/** Resolve overlapping pixel-character hit areas without guessing intent.
 * Opening, cancelling, or invalidating this chooser never selects an actor.
 * The caller still owns action preview, presence and the interaction lock. */
export function createCastPicker(host: HTMLElement, options: CastPickerOptions): CastPicker {
  const dialog = document.createElement('dialog');
  dialog.className = 'vn-cast-picker';
  dialog.dataset.castPicker = 'true';
  dialog.setAttribute('aria-label', '和谁交谈？');
  const heading = document.createElement('h2'); heading.textContent = '和谁交谈？';
  const people = document.createElement('div'); people.className = 'vn-cast-picker-people';
  people.setAttribute('role', 'group'); people.setAttribute('aria-label', '交谈对象');
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'vn-cast-picker-cancel'; cancel.textContent = '取消';
  cancel.dataset.castPickerControl = 'true';
  cancel.setAttribute('aria-label', '取消选择交谈对象');
  dialog.append(heading, people, cancel); host.append(dialog);

  let destroyed = false;
  let session: { triggerId: string; allowedIds: Set<string> } | null = null;
  let focusGeneration = 0;

  function candidates(): CastPickerCandidate[] {
    if (destroyed || !options.isEnabled()) return [];
    const seen = new Set<string>();
    return options.getCandidates().filter(({ id, button }) => {
      if (seen.has(id) || !button.isConnected || button.disabled || button.closest('[inert]')) return false;
      const style = getComputedStyle(button);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      seen.add(id);
      return true;
    });
  }

  function dismiss(restoreFocus: boolean): void {
    const previous = session;
    session = null;
    const generation = ++focusGeneration;
    if (dialog.open) dialog.close();
    people.replaceChildren();
    if (!restoreFocus || !previous || destroyed) return;
    // A snapshot refresh may recreate hotspot buttons in this same turn.
    // Find the stable ID again rather than focusing a detached old element.
    queueMicrotask(() => {
      if (destroyed || session || generation !== focusGeneration) return;
      candidates().find((candidate) => candidate.id === previous.triggerId)?.button.focus({ preventScroll: true });
    });
  }

  function select(id: string): void {
    if (!session?.allowedIds.has(id)) return;
    const present = candidates().some((candidate) => candidate.id === id);
    // Close before invoking the preview callback so focus restoration from
    // native dialog.close cannot steal focus from the new preview controls.
    dismiss(!present);
    if (present && !destroyed && options.isEnabled()) options.onSelect(id);
  }

  cancel.onclick = () => dismiss(true);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(true); });

  return {
    pick(event, triggerId) {
      const current = candidates();
      const trigger = current.find((candidate) => candidate.id === triggerId);
      if (!trigger) return;
      dismiss(false);
      // Keyboard/programmatic activation names the focused button exactly.
      // Only a real pointer click can be ambiguous at overlapping hit areas.
      const hits = event.detail === 0 ? [trigger] : current.filter(({ button }) => {
        const rect = button.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      if (hits.length <= 1) {
        if (options.isEnabled() && candidates().some((candidate) => candidate.id === triggerId)) options.onSelect(triggerId);
        return;
      }
      session = { triggerId, allowedIds: new Set(hits.map((candidate) => candidate.id)) };
      for (const candidate of hits) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'vn-cast-picker-person';
        button.dataset.castPickerControl = 'true'; button.dataset.castPickerId = candidate.id;
        button.textContent = candidate.label;
        button.onclick = () => select(candidate.id);
        people.append(button);
      }
      try {
        dialog.showModal();
        people.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      } catch {
        // Unsupported modal display cannot silently choose somebody else.
        dismiss(true);
      }
    },
    close() { dismiss(true); },
    destroy() {
      if (destroyed) return;
      destroyed = true; dismiss(false); dialog.remove();
    },
  };
}

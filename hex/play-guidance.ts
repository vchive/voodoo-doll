import type { PlayGuidance } from './play-api';

export type GuidanceAction = PlayGuidance['actions'][number] & { hidden?: boolean };

/**
 * Authored actions move the tutorial forward. Scene actions are useful detours
 * and should remain available without looking like the next required step.
 * Keep this client-side classification compatible with both tutorial versions
 * and postscript saves; the server remains authoritative about validity.
 */
export function isStoryAction(action: GuidanceAction): boolean {
  return /^(?:story|full|signal|postscript)-/.test(action.id);
}

export function splitGuidanceActions(actions: GuidanceAction[] | undefined): {
  story: GuidanceAction[];
  exploration: GuidanceAction[];
} {
  const visible = (actions || []).filter((action) => (
    !action.hidden && typeof action.id === 'string' && typeof action.label === 'string' && typeof action.intent === 'string'
  ));
  return {
    story: visible.filter(isStoryAction),
    exploration: visible.filter((action) => !isStoryAction(action)),
  };
}

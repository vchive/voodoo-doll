// UI-only scroll calculations. They never advance a dialogue or a world turn.
export type ScrollPosition = { scrollTop: number; scrollHeight: number; clientHeight: number };
export function remainingScroll(position: ScrollPosition): number {
  return Math.max(0, position.scrollHeight - position.clientHeight - Math.max(0, position.scrollTop));
}
export function hasMoreToRead(position: ScrollPosition): boolean {
  return position.clientHeight > 0 && remainingScroll(position) > 4;
}
export function nextReadingScroll(position: ScrollPosition): number {
  const max = Math.max(0, position.scrollHeight - position.clientHeight);
  return Math.min(max, Math.max(0, position.scrollTop) + Math.max(1, Math.floor(position.clientHeight * .8)));
}
export function canSubmitInput(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode' | 'repeat'>, composing: boolean): boolean {
  return event.key === 'Enter' && !composing && !event.isComposing && event.keyCode !== 229 && !event.repeat;
}

import { replay, type OpsEvent } from "@northline/shared";

export function projectEvents(events: OpsEvent[]) {
  return replay(events);
}

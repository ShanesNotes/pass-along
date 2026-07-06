import {
  EventCatalogSchema,
  type EventCatalog
} from "../../../core/src/index.js";
import type { JobStoragePort } from "./ports.js";
import type { InlineJobRunner } from "./runner.js";

export interface ReplayDlqInput {
  readonly storage: JobStoragePort;
  readonly runner: InlineJobRunner;
  readonly dlqId: string;
  readonly now?: () => Date;
}

export async function replayDlq(input: ReplayDlqInput): Promise<void> {
  const row = await input.storage.getDlqRow(input.dlqId);

  if (!row) {
    throw new Error(`Cannot replay unknown DLQ row ${input.dlqId}`);
  }

  if (row.eventId === null) {
    throw new Error(`Cannot replay DLQ row ${row.id} without an event id`);
  }

  const eventRow = await input.storage.getEventById(row.eventId);

  if (!eventRow) {
    throw new Error(`Cannot replay DLQ row ${row.id}; event is missing`);
  }

  const event = EventCatalogSchema.parse({
    type: eventRow.type,
    payload: eventRow.payload
  }) as EventCatalog;

  await input.runner.replayJob(row.jobName, event, row.attemptGroup);
  await input.storage.markDlqReplayed(row.id, (input.now ?? (() => new Date()))());
}

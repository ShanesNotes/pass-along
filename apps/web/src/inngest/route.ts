import {
  JOB_DEFINITIONS,
  createInMemoryJobStorage,
  createInngestRunner
} from "../../../../packages/engine/src/jobs/index.js";

const storage = createInMemoryJobStorage();
const runner = createInngestRunner({
  id: "pass-along-web",
  storage,
  jobs: JOB_DEFINITIONS
});

export const inngest = runner.client;
export const functions = runner.functions;
export const { GET, POST, PUT } = runner.serveNext();

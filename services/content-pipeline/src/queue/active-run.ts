/**
 * State of the scheduler for `GET /scheduler/active-run`.
 *
 * A scheduler run is a BullMQ Flow: the `scheduler-run` parent job sits in
 * `waiting-children` while its `generate` children run, so checking only the
 * parent's active/waiting lists reports "none" during the whole generation
 * phase. A run counts as active when the parent is active, waiting or
 * waiting-children, OR the generate queue has active/waiting jobs.
 *
 * Response shape is unchanged from the original inline handler:
 * `{ status: "none" }` or
 * `{ status: "active", runId, total, active, completed, failed }`.
 */

interface JobLike {
  data?: { runId?: string } | null;
}

interface SchedulerRunQueueLike {
  getActive: () => Promise<JobLike[]>;
  getWaiting: () => Promise<JobLike[]>;
  getWaitingChildren: () => Promise<JobLike[]>;
}

interface GenerateQueueLike {
  getActive: () => Promise<JobLike[]>;
  getWaiting: () => Promise<JobLike[]>;
  getCompleted: (start?: number, end?: number) => Promise<JobLike[]>;
  getFailed: (start?: number, end?: number) => Promise<JobLike[]>;
}

export type ActiveRunState =
  | { status: "none" }
  | {
      status: "active";
      runId: string | undefined;
      total: number;
      active: number;
      completed: number;
      failed: number;
    };

export async function getActiveRunState(queues: {
  schedulerRunQueue: SchedulerRunQueueLike;
  generateQueue: GenerateQueueLike;
}): Promise<ActiveRunState> {
  const { schedulerRunQueue, generateQueue } = queues;
  const [parentActive, parentWaiting, parentWaitingChildren, genActive, genWaiting] =
    await Promise.all([
      schedulerRunQueue.getActive(),
      schedulerRunQueue.getWaiting(),
      schedulerRunQueue.getWaitingChildren(),
      generateQueue.getActive(),
      generateQueue.getWaiting(),
    ]);

  const parents = [...parentActive, ...parentWaiting, ...parentWaitingChildren];
  if (parents.length === 0 && genActive.length === 0 && genWaiting.length === 0) {
    return { status: "none" };
  }

  const [completed, failed] = await Promise.all([
    generateQueue.getCompleted(0, 100),
    generateQueue.getFailed(0, 100),
  ]);

  const runId = parents[0]?.data?.runId ?? genActive[0]?.data?.runId ?? genWaiting[0]?.data?.runId;
  return {
    status: "active",
    runId,
    total: genActive.length + completed.length + failed.length,
    active: genActive.length,
    completed: completed.length,
    failed: failed.length,
  };
}

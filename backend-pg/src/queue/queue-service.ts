import { Job, JobsOptions, Queue, RepeatOptions, Worker, WorkerListener } from "bullmq";
import Redis from "ioredis";

import { TCreateAuditLogDTO } from "@app/ee/services/audit-log/audit-log-types";
import {
  TScanFullRepoEventPayload,
  TScanPushEventPayload
} from "@app/ee/services/secret-scanning/secret-scanning-queue/secret-scanning-queue-types";

export enum QueueName {
  SecretRotation = "secret-rotation",
  SecretReminder = "secret-reminder",
  AuditLog = "audit-log",
  IntegrationSync = "sync-integrations",
  SecretWebhook = "secret-webhook",
  SecretFullRepoScan = "secret-full-repo-scan",
  SecretPushEventScan = "secret-push-event-scan"
}

export enum QueueJobs {
  SecretReminder = "secret-reminder-job",
  SecretRotation = "secret-rotation-job",
  AuditLog = "audit-log-job",
  SecWebhook = "secret-webhook-trigger",
  IntegrationSync = "secret-integration-pull",
  SecretScan = "secret-scan"
}

export type TQueueJobTypes = {
  [QueueName.SecretReminder]: {
    payload: {
      projectId: string;
      secretId: string;
      repeatDays: number;
      note: string | undefined | null;
    };
    name: QueueJobs.SecretReminder;
  };

  [QueueName.SecretRotation]: {
    payload: { rotationId: string };
    name: QueueJobs.SecretRotation;
  };
  [QueueName.AuditLog]: {
    name: QueueJobs.AuditLog;
    payload: TCreateAuditLogDTO;
  };
  [QueueName.SecretWebhook]: {
    name: QueueJobs.SecWebhook;
    payload: { projectId: string; environment: string; secretPath: string };
  };
  [QueueName.IntegrationSync]: {
    name: QueueJobs.IntegrationSync;
    payload: { projectId: string; environment: string; secretPath: string };
  };
  [QueueName.SecretFullRepoScan]: {
    name: QueueJobs.SecretScan;
    payload: TScanFullRepoEventPayload;
  };
  [QueueName.SecretPushEventScan]: { name: QueueJobs.SecretScan; payload: TScanPushEventPayload };
};

export type TQueueServiceFactory = ReturnType<typeof queueServiceFactory>;
export const queueServiceFactory = (redisUrl: string) => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queueContainer: Record<
    QueueName,
    Queue<TQueueJobTypes[QueueName]["payload"], void, TQueueJobTypes[QueueName]["name"]>
  > = {} as any;
  const workerContainer: Record<
    QueueName,
    Worker<TQueueJobTypes[QueueName]["payload"], void, TQueueJobTypes[QueueName]["name"]>
  > = {} as any;

  const start = <T extends QueueName>(
    name: T,
    jobFn: (
      job: Job<TQueueJobTypes[T]["payload"], void, TQueueJobTypes[T]["name"]>
    ) => Promise<void>
  ) => {
    if (queueContainer[name]) {
      throw new Error(`${name} queue is already initialized`);
    }

    queueContainer[name] = new Queue<TQueueJobTypes[T]["payload"], void, TQueueJobTypes[T]["name"]>(
      name as string,
      { connection }
    );
    workerContainer[name] = new Worker<
      TQueueJobTypes[T]["payload"],
      void,
      TQueueJobTypes[T]["name"]
    >(name, jobFn, { connection });
  };

  const listen = async <
    T extends QueueName,
    U extends keyof WorkerListener<TQueueJobTypes[T]["payload"], void, TQueueJobTypes[T]["name"]>
  >(
    name: T,
    event: U,
    listener: WorkerListener<TQueueJobTypes[T]["payload"], void, TQueueJobTypes[T]["name"]>[U]
  ) => {
    const worker = workerContainer[name];
    worker.on(event, listener);
  };

  const queue = async <T extends QueueName>(
    name: T,
    job: TQueueJobTypes[T]["name"],
    data: TQueueJobTypes[T]["payload"],
    opts: JobsOptions & { jobId?: string }
  ) => {
    const q = queueContainer[name];

    console.log("name", name);
    console.log("query", q);

    await q.add(job, data, opts);
  };

  const stopRepeatableJob = async <T extends QueueName>(
    name: T,
    job: TQueueJobTypes[T]["name"],
    repeatOpt: RepeatOptions,
    jobId?: string
  ) => {
    const q = queueContainer[name];
    return q.removeRepeatable(job, repeatOpt, jobId);
  };

  const stopRepeatableJobByJobId = async <T extends QueueName>(name: T, jobId: string) => {
    const q = queueContainer[name];
    const job = await q.getJob(jobId);
    if (!job) return true;
    if (!job.repeatJobKey) return true;
    return q.removeRepeatableByKey(job.repeatJobKey);
  };

  const shutdown = async () => {
    await Promise.all(Object.values(workerContainer).map((worker) => worker.close()));
  };

  return { start, listen, queue, shutdown, stopRepeatableJob, stopRepeatableJobByJobId };
};

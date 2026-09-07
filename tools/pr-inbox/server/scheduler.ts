interface Job<T = unknown> {
    key: string;
    owner: number;
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
    promise: Promise<T>;
}
/** Two slots remain available for foreground work; speculative reads share one. */
export class Scheduler {
    private readonly jobs = new Map<string, Job>();
    private readonly waiting: Job[] = [];
    private readonly running = new Set<Job>();
    private priorities = new Map<number, number>();
    private closed = false;
    prioritize(numbers: number[]): void {
        this.priorities = new Map(numbers.map((n, i) => [n, i]));
        this.pump();
    }
    request<T>(key: string, owner: number, run: () => Promise<T>): Promise<T> {
        const existing = this.jobs.get(key);
        if (existing) return existing.promise as Promise<T>;
        if (this.closed) return Promise.reject(new Error("Inbox stopped."));
        let resolve!: (value: unknown) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<unknown>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        const job: Job = { key, owner, run, resolve, reject, promise };
        this.jobs.set(key, job);
        this.waiting.push(job);
        queueMicrotask(() => this.pump());
        return promise as Promise<T>;
    }
    private priority(job: Job): number {
        return job.owner === 0 ? -1 : (this.priorities.get(job.owner) ?? 100);
    }
    private pump(): void {
        if (this.closed) return;
        this.waiting.sort((a, b) => this.priority(a) - this.priority(b));
        while (this.running.size < 3 && this.waiting.length > 0) {
            const index = this.waiting.findIndex(
                (candidate) =>
                    this.priority(candidate) <= 0 ||
                    ![...this.running].some((r) => this.priority(r) > 0),
            );
            if (index < 0) break;
            const job = this.waiting.splice(index, 1)[0];
            this.running.add(job);
            const finish = () => {
                this.jobs.delete(job.key);
                this.running.delete(job);
                this.pump();
            };
            void job.run().then(
                (value) => {
                    finish();
                    job.resolve(value);
                },
                (error) => {
                    finish();
                    job.reject(error);
                },
            );
        }
    }
    close(): void {
        this.closed = true;
        for (const job of this.waiting.splice(0)) {
            this.jobs.delete(job.key);
            job.reject(new Error("Inbox stopped."));
        }
    }
}

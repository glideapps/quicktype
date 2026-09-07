import { parsePatch } from "./diff";
interface Task {
    key: string;
    patch: string;
    priority: number;
}
const tasks = new Map<string, Task>();
let scheduled = false;
function work(): void {
    scheduled = false;
    const job = [...tasks.values()].sort((a, b) => a.priority - b.priority)[0];
    if (!job) return;
    tasks.delete(job.key);
    globalThis.postMessage({ key: job.key, lines: parsePatch(job.patch) });
    if (tasks.size > 0) {
        scheduled = true;
        setTimeout(work, 0);
    }
}
globalThis.onmessage = (event: MessageEvent<Task>) => {
    tasks.set(event.data.key, event.data);
    if (!scheduled) {
        scheduled = true;
        setTimeout(work, 0);
    }
};

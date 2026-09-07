import assert from "node:assert/strict";
import { test } from "node:test";

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(): void {}
}

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

const status = { repo: "test/repo", since: "", cutoff: "", loading: false };
const state = { views: {}, drafts: {} };

test("InboxClient reconnects on activation", async (t) => {
    Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: FakeWorker,
    });
    Object.defineProperty(globalThis, "EventSource", {
        configurable: true,
        value: FakeEventSource,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: () => 1,
    });
    t.after(() => {
        Reflect.deleteProperty(globalThis, "Worker");
        Reflect.deleteProperty(globalThis, "EventSource");
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    });

    let bootstraps = 0;
    let releaseBootstrap: (() => void) | undefined;
    let blocked = false;
    let failBootstrap = false;
    t.mock.method(globalThis, "fetch", async () => {
        bootstraps++;
        if (blocked)
            await new Promise<void>((resolve) => {
                releaseBootstrap = resolve;
            });
        if (failBootstrap) return new Response(null, { status: 503 });
        return new Response(
            JSON.stringify({ token: `token-${bootstraps}`, status, state }),
        );
    });

    const { InboxClient } = await import("../web/client.js");
    const client = new InboxClient();

    await client.activate();
    assert.equal(bootstraps, 1);
    assert.equal(FakeEventSource.instances[0].url, "/api/events?token=token-1");

    await client.activate();
    assert.equal(bootstraps, 1, "a fresh connecting source is reused");

    FakeEventSource.instances[0].onopen?.();
    await client.activate();
    assert.equal(bootstraps, 1, "an open connection is reused");

    FakeEventSource.instances[0].onerror?.();
    blocked = true;
    const visible = client.activate();
    const focus = client.activate();
    assert.equal(bootstraps, 2, "simultaneous activation is deduplicated");
    blocked = false;
    releaseBootstrap?.();
    await Promise.all([visible, focus]);

    assert.equal(FakeEventSource.instances[0].closed, true);
    assert.equal(FakeEventSource.instances[1].url, "/api/events?token=token-2");
    FakeEventSource.instances[1].onopen?.();
    assert.equal(client.online, true, "a new server token can reconnect");

    FakeEventSource.instances[0].onerror?.();
    assert.equal(client.online, true, "a superseded source cannot disconnect");

    FakeEventSource.instances[1].onerror?.();
    failBootstrap = true;
    await client.activate();
    assert.equal(bootstraps, 3);
    assert.equal(client.online, false);

    failBootstrap = false;
    await client.activate();
    assert.equal(bootstraps, 4, "activation retries a failed bootstrap");
    assert.equal(FakeEventSource.instances.length, 3);
});

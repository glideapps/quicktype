import { Unsubscribe } from "redux";

type Callback<T> = (payload: T) => void;

let subscriberCount = 0;
const subscribers: Record<string, Record<string, Callback<any>>> = {};

export type Signal = "CopyOutput" | "DownloadOutput";

export function subscribe<T>(signal: Signal, callback: Callback<T>): Unsubscribe {
    const id = subscriberCount++;
    const signalSubscribers = subscribers[signal] || {};
    signalSubscribers[id] = callback;
    subscribers[signal] = signalSubscribers;
    return () => delete subscribers[signal][id];
}

export function send<T>(signal: Signal, payload: T | undefined = undefined) {
    const signalSubscribers = subscribers[signal] || {};
    for (const id of Object.keys(signalSubscribers)) {
        signalSubscribers[id](payload);
    }
}

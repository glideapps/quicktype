import * as path from "path";
import { homedir } from "os";

import * as persist from "node-persist";

// Users of quicktype as a library shouldn't have to init telemetry.
let inited: boolean = false;

export async function init() {
    try {
        await persist.init({
            dir: path.join(homedir(), ".quicktype")
        });
    } catch (error) {
        console.error(`Could not initialize persistence`, error);
    }
    inited = true;
}

export function get<T>(name: string, def: T, onError?: T): T {
    if (inited) {
        try {
            let v = persist.getItemSync(name);
            if (v === undefined) {
                set(name, def);
                v = def;
            }
            return v;
        } catch (error) {
            console.error(`Could not get ${name}`, error);
        }
    }
    return onError !== undefined ? onError : def;
}

export function set<T>(name: string, val: T): void {
    if (!inited) return;

    try {
        persist.setItemSync(name, val);
    } catch (error) {
        console.error(`Could not set ${name}`, error);
    }
}

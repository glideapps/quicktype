import _ from "lodash";

import queryString from "query-string";

function getParsed(): { [key: string]: any } {
    const query = queryString.parse(window.location.search);
    const hash = queryString.parse(window.location.hash);
    return _.merge(query, hash);
}

export function set<T>(key: string, val: T, def?: T) {
    if (def && val === def) {
        return unset(key);
    }
    const parsed = getParsed();
    parsed[key] = val;
    setHash(queryString.stringify(parsed));
}

export function get<T>(...keys: string[]): T | undefined {
    const parsed = getParsed();
    for (const key of keys) {
        if (parsed[key]) {
            return parsed[key];
        }
    }
    return undefined;
}

function removeHash() {
    window.history.replaceState("", document.title, window.location.pathname + window.location.search);
}

function setHash(hash: string) {
    window.history.replaceState("", document.title, "#" + hash);
}

export function unset(key: string) {
    const parsed = getParsed();
    delete parsed[key];
    setHash(queryString.stringify(parsed));
    if (window.location.hash === "") {
        removeHash();
    }
}

import type CrossFetch from "cross-fetch";

let fetch: typeof CrossFetch;

try {
    fetch = global.fetch ?? require("cross-fetch").default;
} catch {
    fetch = require("cross-fetch").default;
}

export { fetch };

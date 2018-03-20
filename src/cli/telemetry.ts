import * as storage from "./storage";
import { NoAnalytics, Analytics, GoogleAnalytics } from "./analytics";

const chalk = require("chalk");

export type TelemetryState = "none" | "disabled" | "enabled";

let analytics: Analytics = new NoAnalytics();

export async function init() {
    await storage.init();

    if (state() === "enabled") {
        analytics = new GoogleAnalytics();
    }
}

export function pageview(page: string): void {
    analytics.pageview(page);
}

export function timing(category: string, variable: string, time: number): void {
    analytics.timing(category, variable, time);
}

export function event(category: string, action: string, label?: string, value?: string | number): void {
    analytics.event(category, action, label, value);
}

export function enable(): void {
    if (state() !== "enabled") {
        console.error(chalk.green("Thank you for enabling telemetry. It helps us make quicktype even better!"));
    }

    setState("enabled");
    analytics = new GoogleAnalytics();
}

export function disable(): void {
    if (state() !== "disabled") {
        console.error("Telemetry disabled. To support quicktype in other ways, please share it.");
    }

    setState("disabled");
    analytics = new NoAnalytics();
}

export function state(): TelemetryState {
    return storage.get<TelemetryState>("analyticsState", "none", "disabled");
}

export function setState(newState: TelemetryState) {
    storage.set("analyticsState", newState);
}

export async function timeAsync<T>(variable: string, work: () => Promise<T>): Promise<T> {
    const start = new Date().getTime();
    const result = await work();
    const end = new Date().getTime();
    timing("default", variable, end - start);
    return result;
}

export const TELEMETRY_HEADER = `Please help improve quicktype by enabling anonymous telemetry with:

  $ quicktype --telemetry enable

You can also enable telemetry on any quicktype invocation:

  $ quicktype pokedex.json -o Pokedex.cs --telemetry enable

This helps us improve quicktype by measuring:

  * How many people use quicktype
  * Which features are popular or unpopular
  * Performance
  * Errors

quicktype does not collect:

  * Your filenames or input data
  * Any personally identifiable information (PII)
  * Anything not directly related to quicktype's usage

If you don't want to help improve quicktype, you can dismiss this message with:

  $ quicktype --telemetry disable

For a full privacy policy, visit app.quicktype.io/privacy
`;
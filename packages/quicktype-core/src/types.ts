export * from "./language/types";
export * from "./language/options.types";

// FIXME: remove these when options are strongly typed
/* eslint-disable @typescript-eslint/no-explicit-any */
export type FixMeOptionsType = Record<string, any>;

// FIXME: Remove this post TS5.4
export type NoInfer<T> = [T][T extends any ? 0 : never];

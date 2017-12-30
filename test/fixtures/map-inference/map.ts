// This file is replaced during the test
export type Top = { [key: string]: string };

export module Convert {
    export function toTop(json: string): Top {
        return JSON.parse(json);
    }
}
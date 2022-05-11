import { Readable } from "readable-stream";
export declare function readableFromFileOrURL(fileOrURL: string, httpHeaders?: string[]): Promise<Readable>;
export declare function readFromFileOrURL(fileOrURL: string, httpHeaders?: string[]): Promise<string>;

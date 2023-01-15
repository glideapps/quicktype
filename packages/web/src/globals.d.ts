declare var ace: any;
declare var embedded: boolean;

declare module "hashcode" {
    interface Hasher {
        value(val: any): number;
    }

    export function hashCode(): Hasher;
}

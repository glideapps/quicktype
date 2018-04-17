import { hash, is } from "immutable";

import { hashCodeInit, addHashCode } from "./Support";

export class Tuple<T, U> {
    constructor(readonly first: T, readonly second: U) {}

    hashCode(): number {
        let hashCode = hashCodeInit;
        hashCode = addHashCode(hashCode, hash(this.first));
        hashCode = addHashCode(hashCode, hash(this.second));
        return hashCode;
    }

    equals(other: any): boolean {
        if (!(other instanceof Tuple)) return false;
        return is(this.first, other.first) && is(this.second, other.second);
    }
}
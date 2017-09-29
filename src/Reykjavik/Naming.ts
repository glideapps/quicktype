"use strict";

import { OrderedSet, List } from "immutable";
import stringHash = require("string-hash");

class Namespace {
    readonly name: string;
    readonly parent?: Namespace;
    children: OrderedSet<Namespace>;
    readonly forbidden: OrderedSet<Namespace>;
    members: OrderedSet<Named>;

    constructor(
        name: string,
        parent: Namespace | undefined,
        forbidden: OrderedSet<Namespace>
    ) {
        this.name = name;
        this.forbidden = forbidden;
        this.members = OrderedSet();
        if (parent) {
            this.parent = parent;
            parent.addChild(this);
        }
    }

    addChild(ns: Namespace): void {
        this.children = this.children.add(ns);
    }

    add(named: Named): void {
        this.members = this.members.add(named);
    }

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        let hash = stringHash(this.name);
        if (this.parent) {
            hash += this.parent.hashCode();
        }
        return hash | 0;
    }
}

// Naming functions are invoked when there are conflicts between names.  Those
// arise under two circumstances, which can also combine:
//
// 1. A proposed name is the same as an already assigned name that's forbidden
//    for the name to be assigned.
// 2. There is more than one Named about to be assigned a name that all have
//    the same proposed name.
//
// The naming function is invoked with the set of all assigned, forbidden names,
// the requested name, and the number of names to generate.

export abstract class Named {
    readonly namespace: Namespace;
    readonly name: string;

    constructor(namespace: Namespace, name: string) {
        this.namespace = namespace;
        this.name = name;
        namespace.add(this);
    }

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        return (stringHash(this.name) + this.namespace.hashCode()) | 0;
    }
}

export class FixedNamed extends Named {}

export class SimpleNamed extends Named {
    // It makes sense for this to be different from the name.  For example, the
    // name for the top-level should be something like "TopLevel", but its
    // preferred name could be "QuickType" or "Pokedex".  Also, once we allow
    // users to override names, the overridden name will be the preferred.  We
    // need to ensure no collisions, so we can't just hard override (unless we
    // still check for collisions and just error if there are any).
    readonly preferred: string;

    constructor(namespace: Namespace, name: string, preferred: string) {
        super(namespace, name);
        this.preferred = preferred;
    }
}

export class DependencyNamed extends Named {
    // This is a List as opposed to a set because it might contain the same
    // name more than once, and we don't want to put the burden of checking
    // on the renderer.
    readonly dependencies: List<Named>;
    // The `names` parameter will contain the names of all `dependencies` in
    // the same order as the latter.  If some of them are the same, `names`
    // will contain their names multiple times.
    readonly proposeName: (names: List<string>) => string;

    constructor(
        namespace: Namespace,
        name: string,
        dependencies: List<Named>,
        proposeName: (names: List<string>) => string
    ) {
        super(namespace, name);
        this.dependencies = dependencies;
        this.proposeName = proposeName;
    }
}

// Naming algorithm:
//
// 1. Find a namespace whose fobiddens are all fully named, and that has
//    at least one unnamed Named that has all its dependencies satisfied.
//    If no such namespace exists we're either done, or there's an unallowed
//    cycle.
//
// 2. Sort those names into sets where all members of a set propose the same
//    name and have the same naming function.
//
// 3. Use each set's naming function to name its members.
//
// 4. Goto 1.

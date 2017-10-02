"use strict";

import { Set, OrderedSet, List, Map } from "immutable";
import stringHash = require("string-hash");

import { Renderer } from "./Renderer";

export class Namespace {
    private readonly _name: string;
    private readonly _parent?: Namespace;
    private _children: OrderedSet<Namespace>;
    private readonly _forbidden: Set<Namespace>;
    private _members: OrderedSet<Named>;

    constructor(
        name: string,
        renderer: Renderer,
        parent: Namespace | undefined,
        forbidden: Set<Namespace>
    ) {
        this._name = name;
        this._forbidden = forbidden;
        this._children = OrderedSet();
        this._members = OrderedSet();
        if (parent) {
            this._parent = parent;
            parent.addChild(this);
        }
    }

    private addChild(child: Namespace): void {
        this._children = this._children.add(child);
    }

    get children(): OrderedSet<Namespace> {
        return this._children;
    }

    get members(): OrderedSet<Named> {
        return this._members;
    }

    add(named: Named): void {
        this._members = this._members.add(named);
    }

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        let hash = stringHash(this._name);
        if (this._parent) {
            hash += this._parent.hashCode();
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
//
// NamingFunction is a class so that we can compare naming functions and put
// them into immutable collections.

abstract class NamingFunction {
    abstract name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string>;
}

export abstract class Named {
    private readonly _namespace: Namespace;
    private readonly _name: string;
    // If a Named is fixed, this is null.
    readonly namingFunction: NamingFunction | null;

    constructor(
        namespace: Namespace,
        name: string,
        namingFunction: NamingFunction | null
    ) {
        this._namespace = namespace;
        this._name = name;
        this.namingFunction = namingFunction;
        namespace.add(this);
    }

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        return (stringHash(this._name) + this._namespace.hashCode()) | 0;
    }

    abstract get dependencies(): List<Named>;

    get isFixed(): boolean {
        return this.namingFunction === null;
    }
}

export class FixedNamed extends Named {
    constructor(namespace: Namespace, name: string) {
        super(namespace, name, null);
    }

    get dependencies(): List<Named> {
        return List();
    }
}

export class SimpleNamed extends Named {
    // It makes sense for this to be different from the name.  For example, the
    // name for the top-level should be something like "TopLevel", but its
    // preferred name could be "QuickType" or "Pokedex".  Also, once we allow
    // users to override names, the overridden name will be the preferred.  We
    // need to ensure no collisions, so we can't just hard override (unless we
    // still check for collisions and just error if there are any).
    private readonly _preferred: string;

    constructor(
        namespace: Namespace,
        name: string,
        namingFunction: NamingFunction,
        preferred: string
    ) {
        super(namespace, name, namingFunction);
        this._preferred = preferred;
    }

    get dependencies(): List<Named> {
        return List();
    }
}

export class DependencyNamed extends Named {
    // This is a List as opposed to a set because it might contain the same
    // name more than once, and we don't want to put the burden of checking
    // on the renderer.
    private readonly _dependencies: List<Named>;
    // The `names` parameter will contain the names of all `dependencies` in
    // the same order as the latter.  If some of them are the same, `names`
    // will contain their names multiple times.
    private readonly _proposeName: (names: List<string>) => string;

    constructor(
        namespace: Namespace,
        name: string,
        namingFunction: NamingFunction,
        dependencies: List<Named>,
        proposeName: (names: List<string>) => string
    ) {
        super(namespace, name, namingFunction);
        this._dependencies = dependencies;
        this._proposeName = proposeName;
    }

    get dependencies(): List<Named> {
        return this._dependencies;
    }
}

function allNamespacesRecursively(
    namespaces: OrderedSet<Namespace>
): OrderedSet<Namespace> {
    return namespaces.union(
        ...namespaces.map(ns => allNamespacesRecursively(ns.children)).toArray()
    );
}

function isFullyNamed(
    namespace: Namespace,
    names: Map<Named, string>
): boolean {
    return namespace.members.every(n => names.has(n));
}

function isReadyToBeNamed(named: Named, names: Map<Named, string>): boolean {
    if (names.has(named)) return false;
    return named.dependencies.every(n => names.has(n));
}

// Naming algorithm
function assignNames(
    rootNamespaces: OrderedSet<Namespace>
): Map<Named, string> {
    const namespaces = allNamespacesRecursively(rootNamespaces);
    let names: Map<Named, string> = Map();

    // Assign all the fixed names.
    const fixedNames = namespaces.flatMap(ns =>
        ns.members.filter(n => n.isFixed)
    );

    for (;;) {
        // 1. Find a namespace whose forbiddens are all fully named, and that has
        //    at least one unnamed Named that has all its dependencies satisfied.
        //    If no such namespace exists we're either done, or there's an unallowed
        //    cycle.

        const unfinishedNamespaces = namespaces.filter(
            ns => !isFullyNamed(ns, names)
        );
        const readyNamespace = unfinishedNamespaces.find(ns =>
            ns.members.some(n => isReadyToBeNamed(n, names))
        );

        if (!readyNamespace) {
            // FIXME: Check for cycles?
            return names;
        }

        // 2. Sort those names into sets where all members of a set propose the same
        //    name and have the same naming function.

        const readyNames = readyNamespace.members.filter(n =>
            isReadyToBeNamed(n, names)
        );

        // 3. Use each set's naming function to name its members.
    }
}

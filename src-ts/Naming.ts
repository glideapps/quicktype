"use strict";

import { Set, OrderedSet, List, Map, Iterable, Range } from "immutable";
import stringHash = require("string-hash");

import { Renderer } from "./Renderer";

export class Namespace {
    private readonly _name: string;
    private readonly _parent?: Namespace;
    private _children: OrderedSet<Namespace>;
    readonly forbiddenNamespaces: Set<Namespace>;
    readonly additionalForbidden: Set<Name>;
    private _members: OrderedSet<Name>;

    constructor(
        name: string,
        parent: Namespace | undefined,
        forbiddenNamespaces: Set<Namespace>,
        additionalForbidden: Set<Name>
    ) {
        this._name = name;
        this.forbiddenNamespaces = forbiddenNamespaces;
        this.additionalForbidden = additionalForbidden;
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

    get members(): OrderedSet<Name> {
        return this._members;
    }

    get forbiddenNameds(): Set<Name> {
        // FIXME: cache
        return this.additionalForbidden.union(
            ...this.forbiddenNamespaces.map((ns: Namespace) => ns.members.toSet()).toArray()
        );
    }

    add<TName extends Name>(named: TName): TName {
        this._members = this._members.add(named);
        return named;
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

export abstract class Namer {
    abstract name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string>;

    abstract equals(other: any): boolean;
    abstract hashCode(): number;
}

export class PrefixNamer extends Namer {
    private readonly _prefixes: OrderedSet<string>;

    constructor(prefixes: string[]) {
        super();
        this._prefixes = OrderedSet(prefixes);
    }

    name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string> {
        if (numberOfNames < 1) {
            throw "Number of names can't be less than 1";
        }

        if (numberOfNames === 1 && !forbiddenNames.has(proposedName)) {
            return OrderedSet([proposedName]);
        }

        const names = this._prefixes
            .flatMap<any, string>((prefix: string): string[] => {
                const name = prefix + proposedName;
                if (forbiddenNames.has(name)) {
                    return [];
                }
                return [name];
            })
            .toList();
        if (names.size >= numberOfNames) {
            return names.take(numberOfNames).toOrderedSet();
        }

        return Range(1)
            .map((n: number) => proposedName + n.toString())
            .filterNot((n: string) => forbiddenNames.has(n))
            .take(numberOfNames)
            .toOrderedSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof PrefixNamer)) {
            return false;
        }
        return other._prefixes.equals(this._prefixes);
    }

    hashCode(): number {
        return this._prefixes.hashCode();
    }
}

export class IncrementingNamer extends Namer {
    name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string> {
        if (numberOfNames < 1) {
            throw "Number of names can't be less than 1";
        }

        if (numberOfNames === 1 && !forbiddenNames.has(proposedName)) {
            return OrderedSet([proposedName]);
        }

        return Range(1)
            .map((n: number) => proposedName + n.toString())
            .filterNot((n: string) => forbiddenNames.has(n))
            .take(numberOfNames)
            .toOrderedSet();
    }

    equals(other: any): boolean {
        return other instanceof IncrementingNamer;
    }

    hashCode(): number {
        return 0;
    }
}

export abstract class Name {
    // If a Named is fixed, the namingFunction is null.
    constructor(readonly namingFunction: Namer | null) {}

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        return 0;
    }

    abstract get dependencies(): List<Name>;

    isFixed(): this is FixedName {
        return this.namingFunction === null;
    }

    abstract proposeName(names: Map<Name, string>): string;
}

// FIXME: FixedNameds should optionally be user-configurable
export class FixedName extends Name {
    constructor(private readonly _fixedName: string) {
        super(null);
    }

    get dependencies(): List<Name> {
        return List();
    }

    proposeName(names?: Map<Name, string>): string {
        return this._fixedName;
    }

    hashCode(): number {
        return (super.hashCode() + stringHash(this._fixedName)) | 0;
    }
}

export class SimpleName extends Name {
    private static defaultNamingFunction = new IncrementingNamer();

    constructor(private readonly _proposed: string, namingFunction?: Namer) {
        super(namingFunction || SimpleName.defaultNamingFunction);
    }

    get dependencies(): List<Name> {
        return List();
    }

    proposeName(names: Map<Name, string>): string {
        return this._proposed;
    }

    hashCode(): number {
        return (super.hashCode() + stringHash(this._proposed)) | 0;
    }
}

export class DependencyName extends Name {
    // _dependencies is a List as opposed to a set because it might contain
    // the same name more than once, and we don't want to put the burden of
    // checking on the renderer.

    // The `names` parameter of _proposeName will contain the names of all
    // `dependencies` in the same order as the latter.  If some of them are
    // the same, `names` will contain their names multiple times.
    constructor(
        namingFunction: Namer,
        private readonly _dependencies: List<Name>,
        private readonly _proposeName: (names: List<string>) => string
    ) {
        super(namingFunction);
    }

    get dependencies(): List<Name> {
        return this._dependencies;
    }

    proposeName(names: Map<Name, string>): string {
        const dependencyNames = this._dependencies.map((n: Name) => names.get(n)).toList();
        return this._proposeName(dependencyNames);
    }

    hashCode(): number {
        return (super.hashCode() + this._dependencies.hashCode()) | 0;
    }
}

export function keywordNamespace(name: string, keywords: string[]) {
    const ns = new Namespace(name, undefined, Set(), Set());
    for (const name of keywords) {
        ns.add(new FixedName(name));
    }
    return ns;
}

function allNamespacesRecursively(namespaces: OrderedSet<Namespace>): OrderedSet<Namespace> {
    return namespaces.union(
        ...namespaces.map((ns: Namespace) => allNamespacesRecursively(ns.children)).toArray()
    );
}

class NamingContext {
    names: Map<Name, string> = Map();
    private _namedsForName: Map<string, Set<Name>> = Map();
    readonly namespaces: OrderedSet<Namespace>;

    constructor(rootNamespaces: OrderedSet<Namespace>) {
        this.namespaces = allNamespacesRecursively(rootNamespaces);
    }

    isReadyToBeNamed = (named: Name): boolean => {
        if (this.names.has(named)) return false;
        return named.dependencies.every((n: Name) => this.names.has(n));
    };

    areForbiddensFullyNamed = (namespace: Namespace): boolean => {
        return namespace.forbiddenNameds.every((n: Name) => this.names.has(n));
    };

    isConflicting = (named: Name, namedNamespace: Namespace, proposed: string): boolean => {
        // If the name is not assigned at all, there is no conflict.
        if (!this._namedsForName.has(proposed)) return false;
        // The name is assigned, but it might still not be forbidden.
        let conflicting: Name | undefined;
        this._namedsForName.get(proposed).forEach((n: Name) => {
            if (namedNamespace.members.contains(n) || namedNamespace.forbiddenNameds.contains(n)) {
                conflicting = n;
                return false;
            }
        });
        return !!conflicting;
    };

    assign = (named: Name, namedNamespace: Namespace, name: string): void => {
        if (this.names.has(named)) {
            throw "Named assigned twice";
        }
        if (this.isConflicting(named, namedNamespace, name)) {
            throw "Assigned name conflicts";
        }
        this.names = this.names.set(named, name);
        if (!this._namedsForName.has(name)) {
            this._namedsForName = this._namedsForName.set(name, Set());
        }
        this._namedsForName.set(name, this._namedsForName.get(name).add(named));
    };
}

// Naming algorithm
export function assignNames(rootNamespaces: OrderedSet<Namespace>): Map<Name, string> {
    const ctx = new NamingContext(rootNamespaces);

    // Assign all fixed names.
    ctx.namespaces.forEach((ns: Namespace) =>
        ns.members.forEach((n: Name) => {
            if (!n.isFixed()) return;
            ctx.assign(n, ns, n.proposeName());
        })
    );

    for (;;) {
        // 1. Find a namespace whose forbiddens are all fully named, and which has
        //    at least one unnamed Named that has all its dependencies satisfied.
        //    If no such namespace exists we're either done, or there's an unallowed
        //    cycle.

        const unfinishedNamespaces = ctx.namespaces.filter(ctx.areForbiddensFullyNamed);
        const readyNamespace = unfinishedNamespaces.find((ns: Namespace) =>
            ns.members.some(ctx.isReadyToBeNamed)
        );

        if (!readyNamespace) {
            // FIXME: Check for cycles?
            return ctx.names;
        }

        const forbiddenNames = readyNamespace.forbiddenNameds
            .map((n: Name) => ctx.names.get(n))
            .toSet();

        // 2. Sort those names into sets where all members of a set propose the same
        //    name and have the same naming function.

        const readyNames = readyNamespace.members.filter(ctx.isReadyToBeNamed);
        // It would be nice if we had tuples, then we wouldn't have to do this in
        // two steps.
        const byNamingFunction = readyNames.groupBy((n: Name) => n.namingFunction);
        byNamingFunction.forEach((nameds: Iterable<Name, Name>, namingFunction: Namer) => {
            const byProposed = nameds.groupBy((n: Name) => n.proposeName(ctx.names));
            byProposed.forEach((nameds: Iterable<Name, Name>, proposed: string) => {
                // 3. Use each set's naming function to name its members.

                const numNames = nameds.size;
                const names = namingFunction.name(proposed, forbiddenNames, numNames);
                const namedsArray = nameds.toArray();
                const namesArray = names.toArray();
                if (namesArray.length !== numNames) {
                    throw "Naming function returned wrong number of names";
                }
                for (let i = 0; i < numNames; i++) {
                    const named = namedsArray[i];
                    const name = namesArray[i];
                    ctx.assign(named, readyNamespace, name);
                }
            });
        });
    }
}

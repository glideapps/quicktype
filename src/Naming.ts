"use strict";

import { Set, OrderedSet, List, Map, Collection, Range } from "immutable";
import stringHash = require("string-hash");

import { Renderer } from "./Renderer";
import { decapitalize } from "./Strings";
import { defined, nonNull, assert, panic } from "./Support";

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

export type NameStyle = (rawName: string) => string;

// `Namer`s are invoked to figure out what names to assign non-fixed `Name`s,
// and in particular to resolve conflicts.  Those arise under two circumstances,
// which can also combine:
//
// 1. A proposed name is the same as an already assigned name that's forbidden
//    for the name to be assigned.
// 2. There is more than one `Name` about to be assigned a name that all have
//    the same proposed name.
//
// The namer is invoked with the set of all assigned, forbidden names,
// the requested name, and the `Name`s to assign names to.
//
// `Namer` is a class so that we can compare namers and put them into immutable
// collections.

export class Namer {
    private readonly _prefixes: OrderedSet<string>;

    constructor(readonly nameStyle: NameStyle, prefixes: string[]) {
        this._prefixes = OrderedSet(prefixes);
    }

    name(
        names: Map<Name, string>,
        forbiddenNames: Set<string>,
        namesToAssign: Collection<any, Name>
    ): Map<Name, string> {
        assert(!namesToAssign.isEmpty(), "Number of names can't be less than 1");

        if (namesToAssign.count() === 1) {
            const name = defined(namesToAssign.first());
            const styledName = this.nameStyle(name.proposeUnstyledName(names));
            const assignedForSingle = name.nameAssignments(forbiddenNames, styledName);
            if (assignedForSingle) {
                return assignedForSingle;
            }
        }

        let allAssignedNames = Map<Name, string>();

        let prefixes = this._prefixes as Collection<any, string>;
        let suffixNumber = 1;
        for (;;) {
            const name = namesToAssign.first();
            if (name === undefined) break;
            const originalName = name.proposeUnstyledName(names);
            let nameToTry: string;
            if (!prefixes.isEmpty()) {
                nameToTry = prefixes.first() + "_" + originalName;
                prefixes = prefixes.rest();
            } else {
                nameToTry = originalName + "_" + suffixNumber.toString();
                suffixNumber++;
            }
            const styledName = this.nameStyle(nameToTry);
            const assigned = name.nameAssignments(forbiddenNames, styledName);
            if (assigned === null) continue;
            allAssignedNames = allAssignedNames.merge(assigned);
            forbiddenNames = forbiddenNames.union(allAssignedNames.toSet());
            namesToAssign = namesToAssign.rest();
        }

        return allAssignedNames;
    }

    equals(other: any): boolean {
        if (!(other instanceof Namer)) {
            return false;
        }
        return this.nameStyle === other.nameStyle && other._prefixes.equals(this._prefixes);
    }

    hashCode(): number {
        return this._prefixes.hashCode();
    }
}

const funPrefixes = [
    "Purple",
    "Fluffy",
    "Tentacled",
    "Sticky",
    "Indigo",
    "Indecent",
    "Hilarious",
    "Ambitious",
    "Cunning",
    "Magenta",
    "Frisky",
    "Mischievous",
    "Braggadocious"
];

export function funPrefixNamer(nameStyle: NameStyle): Namer {
    return new Namer(nameStyle, funPrefixes);
}

// FIXME: I think the type hierarchy is somewhat wrong here.  `FixedName`
// should be a `Name`, but the non-fixed names should probably have their
// own common superclass.  Most methods of `Name` make sense only either
// for `FixedName` or the non-fixed names.

export abstract class Name {
    private _associates = Set<AssociatedName>();

    // If a Named is fixed, the namingFunction is null.
    constructor(readonly namingFunction: Namer | null) {}

    equals(other: any): boolean {
        return this === other;
    }

    hashCode(): number {
        return 0;
    }

    addAssociate(associate: AssociatedName): void {
        this._associates = this._associates.add(associate);
    }

    abstract get dependencies(): List<Name>;

    isFixed(): this is FixedName {
        return this instanceof FixedName;
    }

    abstract proposeUnstyledName(names: Map<Name, string>): string;

    nameAssignments(forbiddenNames: Set<string>, assignedName: string): Map<Name, string> | null {
        if (forbiddenNames.has(assignedName)) return null;
        let assignments = Map<Name, string>().set(this, assignedName);
        let success = true;
        this._associates.forEach((an: AssociatedName) => {
            const associatedAssignedName = an.getName(assignedName);
            if (forbiddenNames.has(associatedAssignedName)) {
                success = false;
                return false;
            }
            assignments = assignments.set(an, associatedAssignedName);
        });
        if (!success) return null;
        return assignments;
    }
}

// FIXME: FixedNameds should optionally be user-configurable
export class FixedName extends Name {
    constructor(private readonly _fixedName: string) {
        super(null);
    }

    get dependencies(): List<Name> {
        return List();
    }

    addAssociate(associate: AssociatedName): never {
        return panic("Cannot add associates to fixed names");
    }

    proposeUnstyledName(names?: Map<Name, string>): string {
        return this._fixedName;
    }

    hashCode(): number {
        return (super.hashCode() + stringHash(this._fixedName)) | 0;
    }
}

export class SimpleName extends Name {
    constructor(private readonly _unstyledName: string, namingFunction: Namer) {
        super(namingFunction);
    }

    get dependencies(): List<Name> {
        return List();
    }

    proposeUnstyledName(names?: Map<Name, string>): string {
        return this._unstyledName;
    }

    hashCode(): number {
        return (super.hashCode() + stringHash(this._unstyledName)) | 0;
    }
}

export class AssociatedName extends Name {
    constructor(private readonly _sponsor: Name, readonly getName: (sponsorName: string) => string) {
        super(null);
    }

    get dependencies(): List<Name> {
        return List([this._sponsor]);
    }

    proposeUnstyledName(names?: Map<Name, string>): never {
        return panic("AssociatedName must be assigned via its sponsor");
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
        private readonly _proposeUnstyledName: (names: List<string>) => string
    ) {
        super(namingFunction);
    }

    get dependencies(): List<Name> {
        return this._dependencies;
    }

    proposeUnstyledName(names: Map<Name, string>): string {
        const dependencyNames = this._dependencies.map((n: Name) => defined(names.get(n))).toList();
        return this._proposeUnstyledName(dependencyNames);
    }

    hashCode(): number {
        return (super.hashCode() + this._dependencies.hashCode()) | 0;
    }
}

export function keywordNamespace(name: string, keywords: string[]) {
    const ns = new Namespace(name, undefined, Set(), Set());
    for (const kw of keywords) {
        ns.add(new FixedName(kw));
    }
    return ns;
}

function allNamespacesRecursively(namespaces: OrderedSet<Namespace>): OrderedSet<Namespace> {
    return namespaces.union(...namespaces.map((ns: Namespace) => allNamespacesRecursively(ns.children)).toArray());
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
        const namedsForProposed = this._namedsForName.get(proposed);
        // If the name is not assigned at all, there is no conflict.
        if (namedsForProposed === undefined) return false;
        // The name is assigned, but it might still not be forbidden.
        let conflicting: Name | undefined;
        namedsForProposed.forEach((n: Name) => {
            if (namedNamespace.members.contains(n) || namedNamespace.forbiddenNameds.contains(n)) {
                conflicting = n;
                return false;
            }
        });
        return !!conflicting;
    };

    assign = (named: Name, namedNamespace: Namespace, name: string): void => {
        assert(!this.names.has(named), "Named assigned twice");
        assert(!this.isConflicting(named, namedNamespace, name), "Assigned name conflicts");
        this.names = this.names.set(named, name);
        let namedsForName = this._namedsForName.get(name);
        if (namedsForName === undefined) {
            namedsForName = Set();
            this._namedsForName = this._namedsForName.set(name, namedsForName);
        }
        this._namedsForName.set(name, namedsForName.add(named));
    };
}

// Naming algorithm
export function assignNames(rootNamespaces: OrderedSet<Namespace>): Map<Name, string> {
    const ctx = new NamingContext(rootNamespaces);

    // Assign all fixed names.
    ctx.namespaces.forEach((ns: Namespace) =>
        ns.members.forEach((n: Name) => {
            if (!n.isFixed()) return;
            ctx.assign(n, ns, n.proposeUnstyledName());
        })
    );

    for (;;) {
        // 1. Find a namespace whose forbiddens are all fully named, and which has
        //    at least one unnamed Named that has all its dependencies satisfied.
        //    If no such namespace exists we're either done, or there's an unallowed
        //    cycle.

        const unfinishedNamespaces = ctx.namespaces.filter(ctx.areForbiddensFullyNamed);
        const readyNamespace = unfinishedNamespaces.find((ns: Namespace) => ns.members.some(ctx.isReadyToBeNamed));

        if (!readyNamespace) {
            // FIXME: Check for cycles?
            return ctx.names;
        }

        let forbiddenNames = readyNamespace.members
            .toSet()
            .union(readyNamespace.forbiddenNameds)
            .filter((n: Name) => ctx.names.has(n))
            .map((n: Name) => defined(ctx.names.get(n)))
            .toSet();

        // 2. Sort those names into sets where all members of a set propose the same
        //    name and have the same naming function.

        const readyNames = readyNamespace.members.filter(ctx.isReadyToBeNamed);
        // It would be nice if we had tuples, then we wouldn't have to do this in
        // two steps.
        const byNamingFunction = readyNames.groupBy((n: Name) => nonNull(n.namingFunction));
        byNamingFunction.forEach((namedsForNamingFunction: Collection<any, Name>, namer: Namer) => {
            const byProposed = namedsForNamingFunction.groupBy((n: Name) =>
                namer.nameStyle(n.proposeUnstyledName(ctx.names))
            );
            byProposed.forEach((nameds: Collection<any, Name>, proposed: string) => {
                // 3. Use each set's naming function to name its members.

                const names = namer.name(ctx.names, forbiddenNames, nameds);
                names.forEach((assigned: string, name: Name) => ctx.assign(name, readyNamespace, assigned));
                forbiddenNames = forbiddenNames.union(names.toSet());
            });
        });
    }
}

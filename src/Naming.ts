import { Set, OrderedSet, List, Map, Collection, hash } from "immutable";

import { defined, assert, panic } from "./Support";

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
        if (parent !== undefined) {
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
        let hashAccumulator = hash(this._name);
        if (this._parent !== undefined) {
            hashAccumulator += this._parent.hashCode();
        }
        return hashAccumulator | 0;
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

    constructor(readonly name: string, readonly nameStyle: NameStyle, prefixes: string[]) {
        this._prefixes = OrderedSet(prefixes);
    }

    assignNames(
        names: Map<Name, string>,
        forbiddenNames: Set<string>,
        namesToAssign: Collection<any, Name>
    ): Map<Name, string> {
        assert(!namesToAssign.isEmpty(), "Number of names can't be less than 1");

        let allAssignedNames = Map<Name, string>();

        let remainingNamesToAssign = namesToAssign;
        let namesToPrefix = List<Name>();
        for (;;) {
            const name = remainingNamesToAssign.first();
            if (name === undefined) break;
            remainingNamesToAssign = remainingNamesToAssign.rest();

            const proposedNames = name.proposeUnstyledNames(names);
            const namingFunction = name.namingFunction;
            // Find the first proposed name that isn't proposed by
            // any of the other names and that isn't already forbidden.
            const maybeUniqueName = proposedNames.find(
                proposed =>
                    !forbiddenNames.has(namingFunction.nameStyle(proposed)) &&
                    namesToAssign.every(n => n === name || !n.proposeUnstyledNames(names).contains(proposed))
            );
            if (maybeUniqueName !== undefined) {
                const styledName = namingFunction.nameStyle(maybeUniqueName);
                const assigned = name.nameAssignments(forbiddenNames, styledName);
                if (assigned) {
                    allAssignedNames = allAssignedNames.merge(assigned);
                    forbiddenNames = forbiddenNames.union(assigned.toSet());
                    continue;
                }
            }

            // There's no unique name, or it couldn't be assigned, so
            // we need to prefix-name this one.
            namesToPrefix = namesToPrefix.push(name);
        }

        let prefixes = this._prefixes as Collection<any, string>;
        let suffixNumber = 1;
        for (;;) {
            const name = namesToPrefix.first();
            if (name === undefined) break;
            const originalName: string = defined(name.proposeUnstyledNames(names).first());
            let nameToTry: string;
            const prefix = prefixes.first();
            if (prefix) {
                nameToTry = `${prefix}_${originalName}`;
                prefixes = prefixes.rest();
            } else {
                nameToTry = `${originalName}_${suffixNumber.toString()}`;
                suffixNumber++;
            }
            const styledName = name.namingFunction.nameStyle(nameToTry);
            const assigned = name.nameAssignments(forbiddenNames, styledName);
            if (assigned === null) continue;
            allAssignedNames = allAssignedNames.merge(assigned);
            forbiddenNames = forbiddenNames.union(assigned.toSet());
            namesToPrefix = namesToPrefix.rest();
        }

        return allAssignedNames;
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

export function funPrefixNamer(name: string, nameStyle: NameStyle): Namer {
    return new Namer(name, nameStyle, funPrefixes);
}

// FIXME: I think the type hierarchy is somewhat wrong here.  `FixedName`
// should be a `Name`, but the non-fixed names should probably have their
// own common superclass.  Most methods of `Name` make sense only either
// for `FixedName` or the non-fixed names.

export abstract class Name {
    private _associates = Set<AssociatedName>();

    // If a Named is fixed, the namingFunction is undefined.
    constructor(private readonly _namingFunction: Namer | undefined, readonly order: number) {}

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

    get namingFunction(): Namer {
        return defined(this._namingFunction);
    }

    // Must return at least one proposal.  The proposals are considered in order.
    abstract proposeUnstyledNames(names: Map<Name, string>): OrderedSet<string>;

    firstProposedName = (names: Map<Name, string>): string => {
        return defined(this.proposeUnstyledNames(names).first());
    };

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
        super(undefined, 0);
    }

    get dependencies(): List<Name> {
        return List();
    }

    addAssociate(_: AssociatedName): never {
        return panic("Cannot add associates to fixed names");
    }

    get fixedName(): string {
        return this._fixedName;
    }

    proposeUnstyledNames(_?: Map<Name, string>): OrderedSet<string> {
        return panic("Only fixedName should be called on FixedName.");
    }

    hashCode(): number {
        return (super.hashCode() + hash(this._fixedName)) | 0;
    }
}

export class SimpleName extends Name {
    constructor(private readonly _unstyledNames: OrderedSet<string>, namingFunction: Namer, order: number) {
        super(namingFunction, order);
    }

    get dependencies(): List<Name> {
        return List();
    }

    proposeUnstyledNames(_?: Map<Name, string>): OrderedSet<string> {
        return this._unstyledNames;
    }

    hashCode(): number {
        return (super.hashCode() + this._unstyledNames.hashCode()) | 0;
    }
}

export class AssociatedName extends Name {
    constructor(private readonly _sponsor: Name, order: number, readonly getName: (sponsorName: string) => string) {
        super(undefined, order);
    }

    get dependencies(): List<Name> {
        return List([this._sponsor]);
    }

    proposeUnstyledNames(_?: Map<Name, string>): never {
        return panic("AssociatedName must be assigned via its sponsor");
    }
}

export class DependencyName extends Name {
    private readonly _dependencies: OrderedSet<Name>;

    constructor(
        namingFunction: Namer | undefined,
        order: number,
        private readonly _proposeUnstyledName: (lookup: (n: Name) => string) => string
    ) {
        super(namingFunction, order);
        const dependencies: Name[] = [];
        _proposeUnstyledName(n => {
            dependencies.push(n);
            return "0xDEADBEEF";
        });
        this._dependencies = OrderedSet(dependencies);
    }

    get dependencies(): List<Name> {
        return this._dependencies.toList();
    }

    proposeUnstyledNames(names: Map<Name, string>): OrderedSet<string> {
        return OrderedSet([
            this._proposeUnstyledName(n => {
                assert(this._dependencies.has(n), "DependencyName proposer is not pure");
                return defined(names.get(n));
            })
        ]);
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

    isConflicting = (namedNamespace: Namespace, proposed: string): boolean => {
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
        return conflicting !== undefined;
    };

    assign = (named: Name, namedNamespace: Namespace, name: string): void => {
        assert(!this.names.has(named), "Named assigned twice");
        assert(!this.isConflicting(namedNamespace, name), "Assigned name conflicts");
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
            ctx.assign(n, ns, n.fixedName);
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

        // 2. From low order to high order, sort those names into sets where all
        //    members of a set propose the same name and have the same naming
        //    function.

        for (;;) {
            const allReadyNames = readyNamespace.members.filter(ctx.isReadyToBeNamed);
            const minOrderName = allReadyNames.minBy(n => n.order);
            if (minOrderName === undefined) break;
            const minOrder = minOrderName.order;
            const readyNames = allReadyNames.filter(n => n.order === minOrder);

            // It would be nice if we had tuples, then we wouldn't have to do this in
            // two steps.
            const byNamingFunction = readyNames.groupBy(n => n.namingFunction);
            byNamingFunction.forEach((namedsForNamingFunction: Collection<any, Name>, namer: Namer) => {
                const byProposed = namedsForNamingFunction.groupBy(n =>
                    n.namingFunction.nameStyle(n.firstProposedName(ctx.names))
                );
                byProposed.forEach((nameds: Collection<any, Name>, _: string) => {
                    // 3. Use each set's naming function to name its members.

                    const names = namer.assignNames(ctx.names, forbiddenNames, nameds);
                    names.forEach((assigned: string, name: Name) => ctx.assign(name, readyNamespace, assigned));
                    forbiddenNames = forbiddenNames.union(names.toSet());
                });
            });
        }
    }
}

import { Set as ImmutableSet, OrderedSet, Map } from "immutable";

import { defined, assert, panic } from "./support/Support";
import {
    setUnion,
    setMap,
    setFilter,
    iterableFind,
    iterableSome,
    iterableMinBy,
    setGroupBy,
    setFilterMap,
    iterableFirst,
    iterableEvery
} from "./support/Containers";

export class Namespace {
    private _children: OrderedSet<Namespace>;
    readonly forbiddenNamespaces: ImmutableSet<Namespace>;
    readonly additionalForbidden: ImmutableSet<Name>;
    private _members: OrderedSet<Name>;

    constructor(
        _name: string,
        parent: Namespace | undefined,
        forbiddenNamespaces: Iterable<Namespace>,
        additionalForbidden: Iterable<Name>
    ) {
        this.forbiddenNamespaces = ImmutableSet(forbiddenNamespaces);
        this.additionalForbidden = ImmutableSet(additionalForbidden);
        this._children = OrderedSet();
        this._members = OrderedSet();
        if (parent !== undefined) {
            parent.addChild(this);
        }
    }

    private addChild(child: Namespace): void {
        this._children = this._children.add(child);
    }

    get children(): ReadonlySet<Namespace> {
        return this._children;
    }

    get members(): ReadonlySet<Name> {
        return this._members;
    }

    get forbiddenNameds(): ReadonlySet<Name> {
        // FIXME: cache
        return this.additionalForbidden.union(...this.forbiddenNamespaces.map(ns => ns.members).toArray());
    }

    add<TName extends Name>(named: TName): TName {
        this._members = this._members.add(named);
        return named;
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
        forbiddenNames: ReadonlySet<string>,
        namesToAssignIterable: Iterable<Name>
    ): Map<Name, string> {
        const namesToAssign = Array.from(namesToAssignIterable);

        assert(namesToAssign.length > 0, "Number of names can't be less than 1");

        let allAssignedNames = Map<Name, string>();

        let namesToPrefix: Name[] = [];
        for (const name of namesToAssign) {
            const proposedNames = name.proposeUnstyledNames(names);
            const namingFunction = name.namingFunction;
            // Find the first proposed name that isn't proposed by
            // any of the other names and that isn't already forbidden.
            const maybeUniqueName = iterableFind(
                proposedNames,
                proposed =>
                    !forbiddenNames.has(namingFunction.nameStyle(proposed)) &&
                    namesToAssign.every(n => n === name || !n.proposeUnstyledNames(names).has(proposed))
            );
            if (maybeUniqueName !== undefined) {
                const styledName = namingFunction.nameStyle(maybeUniqueName);
                const assigned = name.nameAssignments(forbiddenNames, styledName);
                if (assigned) {
                    allAssignedNames = allAssignedNames.merge(assigned);
                    forbiddenNames = setUnion(forbiddenNames, assigned.valueSeq());
                    continue;
                }
            }

            // There's no unique name, or it couldn't be assigned, so
            // we need to prefix-name this one.
            namesToPrefix.push(name);
        }

        let prefixes = this._prefixes;
        let suffixNumber = 1;
        for (const name of namesToPrefix) {
            const originalName: string = defined(iterableFirst(name.proposeUnstyledNames(names)));
            for (;;) {
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
                forbiddenNames = setUnion(forbiddenNames, assigned.valueSeq());
            }
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
    private readonly _associates = new Set<AssociatedName>();

    // If a Named is fixed, the namingFunction is undefined.
    constructor(private readonly _namingFunction: Namer | undefined, readonly order: number) {}

    addAssociate(associate: AssociatedName): void {
        this._associates.add(associate);
    }

    abstract get dependencies(): ReadonlyArray<Name>;

    isFixed(): this is FixedName {
        return this instanceof FixedName;
    }

    get namingFunction(): Namer {
        return defined(this._namingFunction);
    }

    // Must return at least one proposal.  The proposals are considered in order.
    abstract proposeUnstyledNames(names: Map<Name, string>): ReadonlySet<string>;

    firstProposedName(names: Map<Name, string>): string {
        return defined(iterableFirst(this.proposeUnstyledNames(names)));
    }

    nameAssignments(forbiddenNames: ReadonlySet<string>, assignedName: string): Map<Name, string> | null {
        if (forbiddenNames.has(assignedName)) return null;
        let assignments = Map<Name, string>().set(this, assignedName);
        for (const an of this._associates) {
            const associatedAssignedName = an.getName(assignedName);
            if (forbiddenNames.has(associatedAssignedName)) {
                return null;
            }
            assignments = assignments.set(an, associatedAssignedName);
        }
        return assignments;
    }
}

// FIXME: FixedNameds should optionally be user-configurable
export class FixedName extends Name {
    constructor(private readonly _fixedName: string) {
        super(undefined, 0);
    }

    get dependencies(): ReadonlyArray<Name> {
        return [];
    }

    addAssociate(_: AssociatedName): never {
        return panic("Cannot add associates to fixed names");
    }

    get fixedName(): string {
        return this._fixedName;
    }

    proposeUnstyledNames(_?: Map<Name, string>): ReadonlySet<string> {
        return panic("Only fixedName should be called on FixedName.");
    }
}

export class SimpleName extends Name {
    constructor(private readonly _unstyledNames: OrderedSet<string>, namingFunction: Namer, order: number) {
        super(namingFunction, order);
    }

    get dependencies(): ReadonlyArray<Name> {
        return [];
    }

    proposeUnstyledNames(_?: Map<Name, string>): ReadonlySet<string> {
        return this._unstyledNames;
    }
}

export class AssociatedName extends Name {
    constructor(private readonly _sponsor: Name, order: number, readonly getName: (sponsorName: string) => string) {
        super(undefined, order);
    }

    get dependencies(): ReadonlyArray<Name> {
        return [this._sponsor];
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

    get dependencies(): ReadonlyArray<Name> {
        return Array.from(this._dependencies);
    }

    proposeUnstyledNames(names: Map<Name, string>): ReadonlySet<string> {
        return OrderedSet([
            this._proposeUnstyledName(n => {
                assert(this._dependencies.has(n), "DependencyName proposer is not pure");
                return defined(names.get(n));
            })
        ]);
    }
}

export function keywordNamespace(name: string, keywords: string[]) {
    const ns = new Namespace(name, undefined, ImmutableSet(), ImmutableSet());
    for (const kw of keywords) {
        ns.add(new FixedName(kw));
    }
    return ns;
}

function allNamespacesRecursively(namespaces: Iterable<Namespace>): ReadonlySet<Namespace> {
    return setUnion(namespaces, ...Array.from(setMap(namespaces, ns => allNamespacesRecursively(ns.children))));
}

class NamingContext {
    names: Map<Name, string> = Map();
    private _namedsForName: Map<string, ImmutableSet<Name>> = Map();
    readonly namespaces: ReadonlySet<Namespace>;

    constructor(rootNamespaces: Iterable<Namespace>) {
        this.namespaces = allNamespacesRecursively(rootNamespaces);
    }

    isReadyToBeNamed = (named: Name): boolean => {
        if (this.names.has(named)) return false;
        return named.dependencies.every((n: Name) => this.names.has(n));
    };

    areForbiddensFullyNamed(namespace: Namespace): boolean {
        return iterableEvery(namespace.forbiddenNameds, n => this.names.has(n));
    }

    isConflicting = (namedNamespace: Namespace, proposed: string): boolean => {
        const namedsForProposed = this._namedsForName.get(proposed);
        // If the name is not assigned at all, there is no conflict.
        if (namedsForProposed === undefined) return false;
        // The name is assigned, but it might still not be forbidden.
        let conflicting: Name | undefined;
        namedsForProposed.forEach((n: Name) => {
            if (namedNamespace.members.has(n) || namedNamespace.forbiddenNameds.has(n)) {
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
            namedsForName = ImmutableSet();
            this._namedsForName = this._namedsForName.set(name, namedsForName);
        }
        this._namedsForName.set(name, namedsForName.add(named));
    };
}

// Naming algorithm
export function assignNames(rootNamespaces: Iterable<Namespace>): Map<Name, string> {
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

        const unfinishedNamespaces = setFilter(ctx.namespaces, ns => ctx.areForbiddensFullyNamed(ns));
        const readyNamespace = iterableFind(unfinishedNamespaces, ns => iterableSome(ns.members, ctx.isReadyToBeNamed));

        if (!readyNamespace) {
            // FIXME: Check for cycles?
            return ctx.names;
        }

        const allForbiddenNames = setUnion(readyNamespace.members, readyNamespace.forbiddenNameds);
        let forbiddenNames = setFilterMap(allForbiddenNames, n => ctx.names.get(n));

        // 2. From low order to high order, sort those names into sets where all
        //    members of a set propose the same name and have the same naming
        //    function.

        for (;;) {
            const allReadyNames = setFilter(readyNamespace.members, ctx.isReadyToBeNamed);
            const minOrderName = iterableMinBy(allReadyNames, n => n.order);
            if (minOrderName === undefined) break;
            const minOrder = minOrderName.order;
            const readyNames = setFilter(allReadyNames, n => n.order === minOrder);

            // It would be nice if we had tuples, then we wouldn't have to do this in
            // two steps.
            const byNamingFunction = setGroupBy(readyNames, n => n.namingFunction);
            byNamingFunction.forEach((namedsForNamingFunction, namer) => {
                const byProposed = setGroupBy(namedsForNamingFunction, n =>
                    n.namingFunction.nameStyle(n.firstProposedName(ctx.names))
                );
                byProposed.forEach(nameds => {
                    // 3. Use each set's naming function to name its members.

                    const names = namer.assignNames(ctx.names, forbiddenNames, nameds);
                    names.forEach((assigned: string, name: Name) => ctx.assign(name, readyNamespace, assigned));
                    forbiddenNames = setUnion(forbiddenNames, names.valueSeq());
                });
            });
        }
    }
}

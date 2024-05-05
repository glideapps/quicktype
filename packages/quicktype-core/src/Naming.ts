import {
    iterableEvery,
    iterableFind,
    iterableFirst,
    iterableMinBy,
    iterableSome,
    mapMergeInto,
    setFilter,
    setFilterMap,
    setGroupBy,
    setMap,
    setUnion,
    setUnionInto
} from "collection-utils";

import { assert, defined, panic } from "./support/Support";

export class Namespace {
    public readonly forbiddenNamespaces: ReadonlySet<Namespace>;

    public readonly additionalForbidden: ReadonlySet<Name>;

    private readonly _children = new Set<Namespace>();

    private readonly _members = new Set<Name>();

    public constructor(
        _name: string,
        parent: Namespace | undefined,
        forbiddenNamespaces: Iterable<Namespace>,
        additionalForbidden: Iterable<Name>
    ) {
        this.forbiddenNamespaces = new Set(forbiddenNamespaces);
        this.additionalForbidden = new Set(additionalForbidden);
        if (parent !== undefined) {
            parent.addChild(this);
        }
    }

    private addChild(child: Namespace): void {
        this._children.add(child);
    }

    public get children(): ReadonlySet<Namespace> {
        return this._children;
    }

    public get members(): ReadonlySet<Name> {
        return this._members;
    }

    public get forbiddenNameds(): ReadonlySet<Name> {
        // FIXME: cache
        return setUnion(this.additionalForbidden, ...Array.from(this.forbiddenNamespaces).map(ns => ns.members));
    }

    public add<TName extends Name>(named: TName): TName {
        this._members.add(named);
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
    private readonly _prefixes: ReadonlySet<string>;

    public constructor(
        public readonly name: string,
        public readonly nameStyle: NameStyle,
        public prefixes: string[]
    ) {
        this._prefixes = new Set(prefixes);
    }

    // The namesIterable comes directly out of the context and will
    // be modified if we assign
    public assignNames(
        names: ReadonlyMap<Name, string>,
        forbiddenNamesIterable: Iterable<string>,
        namesToAssignIterable: Iterable<Name>
    ): ReadonlyMap<Name, string> {
        const forbiddenNames = new Set(forbiddenNamesIterable);
        const namesToAssign = Array.from(namesToAssignIterable);

        assert(namesToAssign.length > 0, "Number of names can't be less than 1");

        const allAssignedNames = new Map<Name, string>();

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
                if (assigned !== null) {
                    mapMergeInto(allAssignedNames, assigned);
                    setUnionInto(forbiddenNames, assigned.values());
                    continue;
                }
            }

            // There's no unique name, or it couldn't be assigned, so
            // we need to prefix-name this one.
            namesToPrefix.push(name);
        }

        let prefixes = this._prefixes.values();
        let suffixNumber = 1;
        for (const name of namesToPrefix) {
            const originalName: string = defined(iterableFirst(name.proposeUnstyledNames(names)));
            for (;;) {
                let nameToTry: string;
                const { done, value: prefix } = prefixes.next();
                if (!done) {
                    nameToTry = `${prefix}_${originalName}`;
                } else {
                    nameToTry = `${originalName}_${suffixNumber.toString()}`;
                    suffixNumber++;
                }

                const styledName = name.namingFunction.nameStyle(nameToTry);
                const assigned = name.nameAssignments(forbiddenNames, styledName);
                if (assigned === null) continue;
                mapMergeInto(allAssignedNames, assigned);
                setUnionInto(forbiddenNames, assigned.values());
                break;
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
    public constructor(
        private readonly _namingFunction: Namer | undefined,
        public readonly order: number
    ) {}

    public addAssociate(associate: AssociatedName): void {
        this._associates.add(associate);
    }

    public abstract get dependencies(): readonly Name[];

    public isFixed(): this is FixedName {
        return this instanceof FixedName;
    }

    public get namingFunction(): Namer {
        return defined(this._namingFunction);
    }

    // Must return at least one proposal.  The proposals are considered in order.
    public abstract proposeUnstyledNames(names: ReadonlyMap<Name, string>): ReadonlySet<string>;

    public firstProposedName(names: ReadonlyMap<Name, string>): string {
        return defined(iterableFirst(this.proposeUnstyledNames(names)));
    }

    public nameAssignments(
        forbiddenNames: ReadonlySet<string>,
        assignedName: string
    ): ReadonlyMap<Name, string> | null {
        if (forbiddenNames.has(assignedName)) return null;
        const assignments = new Map<Name, string>([[this, assignedName]]);
        for (const an of this._associates) {
            const associatedAssignedName = an.getName(assignedName);
            if (forbiddenNames.has(associatedAssignedName)) {
                return null;
            }

            assignments.set(an, associatedAssignedName);
        }

        return assignments;
    }
}

// FIXME: FixedNameds should optionally be user-configurable
export class FixedName extends Name {
    public constructor(private readonly _fixedName: string) {
        super(undefined, 0);
    }

    public get dependencies(): readonly Name[] {
        return [];
    }

    public addAssociate(_: AssociatedName): never {
        return panic("Cannot add associates to fixed names");
    }

    public get fixedName(): string {
        return this._fixedName;
    }

    public proposeUnstyledNames(_?: ReadonlyMap<Name, string>): ReadonlySet<string> {
        return panic("Only fixedName should be called on FixedName.");
    }
}

export class SimpleName extends Name {
    private readonly _unstyledNames: ReadonlySet<string>;

    public constructor(unstyledNames: Iterable<string>, namingFunction: Namer, order: number) {
        super(namingFunction, order);
        this._unstyledNames = new Set(unstyledNames);
    }

    public get dependencies(): readonly Name[] {
        return [];
    }

    public proposeUnstyledNames(_?: ReadonlyMap<Name, string>): ReadonlySet<string> {
        return this._unstyledNames;
    }
}

export class AssociatedName extends Name {
    public constructor(
        private readonly _sponsor: Name,
        order: number,
        public readonly getName: (sponsorName: string) => string
    ) {
        super(undefined, order);
    }

    public get dependencies(): readonly Name[] {
        return [this._sponsor];
    }

    public proposeUnstyledNames(_?: ReadonlyMap<Name, string>): never {
        return panic("AssociatedName must be assigned via its sponsor");
    }
}

export class DependencyName extends Name {
    private readonly _dependencies: ReadonlySet<Name>;

    public constructor(
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
        this._dependencies = new Set(dependencies);
    }

    public get dependencies(): readonly Name[] {
        return Array.from(this._dependencies);
    }

    public proposeUnstyledNames(names: ReadonlyMap<Name, string>): ReadonlySet<string> {
        return new Set([
            this._proposeUnstyledName(n => {
                assert(this._dependencies.has(n), "DependencyName proposer is not pure");
                return defined(names.get(n));
            })
        ]);
    }
}

export function keywordNamespace(name: string, keywords: string[]): Namespace {
    const ns = new Namespace(name, undefined, [], []);
    for (const kw of keywords) {
        ns.add(new FixedName(kw));
    }

    return ns;
}

function allNamespacesRecursively(namespaces: Iterable<Namespace>): ReadonlySet<Namespace> {
    return setUnion(namespaces, ...Array.from(setMap(namespaces, ns => allNamespacesRecursively(ns.children))));
}

class NamingContext {
    private readonly _names: Map<Name, string> = new Map();

    private readonly _namedsForName: Map<string, Set<Name>> = new Map();

    public readonly namespaces: ReadonlySet<Namespace>;

    public constructor(rootNamespaces: Iterable<Namespace>) {
        this.namespaces = allNamespacesRecursively(rootNamespaces);
    }

    public get names(): ReadonlyMap<Name, string> {
        return this._names;
    }

    public isReadyToBeNamed(named: Name): boolean {
        if (this._names.has(named)) return false;
        return named.dependencies.every((n: Name) => this._names.has(n));
    }

    public areForbiddensFullyNamed(namespace: Namespace): boolean {
        return iterableEvery(namespace.forbiddenNameds, n => this._names.has(n));
    }

    public isConflicting(namedNamespace: Namespace, proposed: string): boolean {
        const namedsForProposed = this._namedsForName.get(proposed);
        // If the name is not assigned at all, there is no conflict.
        if (namedsForProposed === undefined) return false;
        // The name is assigned, but it might still not be forbidden.
        for (const n of namedsForProposed) {
            if (namedNamespace.members.has(n) || namedNamespace.forbiddenNameds.has(n)) {
                return true;
            }
        }

        return false;
    }

    public assign(named: Name, namedNamespace: Namespace, name: string): void {
        assert(!this.names.has(named), `Name "${name}" assigned twice`);
        assert(!this.isConflicting(namedNamespace, name), `Assigned name "${name}" conflicts`);
        this._names.set(named, name);
        let namedsForName = this._namedsForName.get(name);
        if (namedsForName === undefined) {
            namedsForName = new Set();
            this._namedsForName.set(name, namedsForName);
        }

        namedsForName.add(named);
    }
}

// Naming algorithm
export function assignNames(rootNamespaces: Iterable<Namespace>): ReadonlyMap<Name, string> {
    const ctx = new NamingContext(rootNamespaces);

    // Assign all fixed names.
    for (const ns of ctx.namespaces) {
        for (const n of ns.members) {
            if (!n.isFixed()) continue;
            ctx.assign(n, ns, n.fixedName);
        }
    }

    for (;;) {
        // 1. Find a namespace whose forbiddens are all fully named, and which has
        //    at least one unnamed Named that has all its dependencies satisfied.
        //    If no such namespace exists we're either done, or there's an unallowed
        //    cycle.

        const unfinishedNamespaces = setFilter(ctx.namespaces, ns => ctx.areForbiddensFullyNamed(ns));
        const readyNamespace = iterableFind(unfinishedNamespaces, ns =>
            iterableSome(ns.members, member => ctx.isReadyToBeNamed(member))
        );

        if (readyNamespace === undefined) {
            // FIXME: Check for cycles?
            return ctx.names;
        }

        const allForbiddenNames = setUnion(readyNamespace.members, readyNamespace.forbiddenNameds);
        let forbiddenNames = setFilterMap(allForbiddenNames, n => ctx.names.get(n));

        // 2. From low order to high order, sort those names into sets where all
        //    members of a set propose the same name and have the same naming
        //    function.

        for (;;) {
            const allReadyNames = setFilter(readyNamespace.members, member => ctx.isReadyToBeNamed(member));
            const minOrderName = iterableMinBy(allReadyNames, n => n.order);
            if (minOrderName === undefined) break;
            const minOrder = minOrderName.order;
            const readyNames = setFilter(allReadyNames, n => n.order === minOrder);

            // It would be nice if we had tuples, then we wouldn't have to do this in
            // two steps.
            const byNamingFunction = setGroupBy(readyNames, n => n.namingFunction);
            for (const [namer, namedsForNamingFunction] of byNamingFunction) {
                const byProposed = setGroupBy(namedsForNamingFunction, n =>
                    n.namingFunction.nameStyle(n.firstProposedName(ctx.names))
                );
                for (const [, nameds] of byProposed) {
                    // 3. Use each set's naming function to name its members.

                    const names = namer.assignNames(ctx.names, forbiddenNames, nameds);
                    for (const [name, assigned] of names) {
                        ctx.assign(name, readyNamespace, assigned);
                    }

                    setUnionInto(forbiddenNames, names.values());
                }
            }
        }
    }
}

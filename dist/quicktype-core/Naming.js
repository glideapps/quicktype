"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");
class Namespace {
    constructor(_name, parent, forbiddenNamespaces, additionalForbidden) {
        this._children = new Set();
        this._members = new Set();
        this.forbiddenNamespaces = new Set(forbiddenNamespaces);
        this.additionalForbidden = new Set(additionalForbidden);
        if (parent !== undefined) {
            parent.addChild(this);
        }
    }
    addChild(child) {
        this._children.add(child);
    }
    get children() {
        return this._children;
    }
    get members() {
        return this._members;
    }
    get forbiddenNameds() {
        // FIXME: cache
        return collection_utils_1.setUnion(this.additionalForbidden, ...Array.from(this.forbiddenNamespaces).map(ns => ns.members));
    }
    add(named) {
        this._members.add(named);
        return named;
    }
}
exports.Namespace = Namespace;
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
class Namer {
    constructor(name, nameStyle, prefixes) {
        this.name = name;
        this.nameStyle = nameStyle;
        this._prefixes = new Set(prefixes);
    }
    // The namesIterable comes directly out of the context and will
    // be modified if we assign
    assignNames(names, forbiddenNamesIterable, namesToAssignIterable) {
        const forbiddenNames = new Set(forbiddenNamesIterable);
        const namesToAssign = Array.from(namesToAssignIterable);
        Support_1.assert(namesToAssign.length > 0, "Number of names can't be less than 1");
        const allAssignedNames = new Map();
        let namesToPrefix = [];
        for (const name of namesToAssign) {
            const proposedNames = name.proposeUnstyledNames(names);
            const namingFunction = name.namingFunction;
            // Find the first proposed name that isn't proposed by
            // any of the other names and that isn't already forbidden.
            const maybeUniqueName = collection_utils_1.iterableFind(proposedNames, proposed => !forbiddenNames.has(namingFunction.nameStyle(proposed)) &&
                namesToAssign.every(n => n === name || !n.proposeUnstyledNames(names).has(proposed)));
            if (maybeUniqueName !== undefined) {
                const styledName = namingFunction.nameStyle(maybeUniqueName);
                const assigned = name.nameAssignments(forbiddenNames, styledName);
                if (assigned !== null) {
                    collection_utils_1.mapMergeInto(allAssignedNames, assigned);
                    collection_utils_1.setUnionInto(forbiddenNames, assigned.values());
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
            const originalName = Support_1.defined(collection_utils_1.iterableFirst(name.proposeUnstyledNames(names)));
            for (;;) {
                let nameToTry;
                const { done, value: prefix } = prefixes.next();
                if (!done) {
                    nameToTry = `${prefix}_${originalName}`;
                }
                else {
                    nameToTry = `${originalName}_${suffixNumber.toString()}`;
                    suffixNumber++;
                }
                const styledName = name.namingFunction.nameStyle(nameToTry);
                const assigned = name.nameAssignments(forbiddenNames, styledName);
                if (assigned === null)
                    continue;
                collection_utils_1.mapMergeInto(allAssignedNames, assigned);
                collection_utils_1.setUnionInto(forbiddenNames, assigned.values());
                break;
            }
        }
        return allAssignedNames;
    }
}
exports.Namer = Namer;
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
function funPrefixNamer(name, nameStyle) {
    return new Namer(name, nameStyle, funPrefixes);
}
exports.funPrefixNamer = funPrefixNamer;
// FIXME: I think the type hierarchy is somewhat wrong here.  `FixedName`
// should be a `Name`, but the non-fixed names should probably have their
// own common superclass.  Most methods of `Name` make sense only either
// for `FixedName` or the non-fixed names.
class Name {
    // If a Named is fixed, the namingFunction is undefined.
    constructor(_namingFunction, order) {
        this._namingFunction = _namingFunction;
        this.order = order;
        this._associates = new Set();
    }
    addAssociate(associate) {
        this._associates.add(associate);
    }
    isFixed() {
        return this instanceof FixedName;
    }
    get namingFunction() {
        return Support_1.defined(this._namingFunction);
    }
    firstProposedName(names) {
        return Support_1.defined(collection_utils_1.iterableFirst(this.proposeUnstyledNames(names)));
    }
    nameAssignments(forbiddenNames, assignedName) {
        if (forbiddenNames.has(assignedName))
            return null;
        const assignments = new Map([[this, assignedName]]);
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
exports.Name = Name;
// FIXME: FixedNameds should optionally be user-configurable
class FixedName extends Name {
    constructor(_fixedName) {
        super(undefined, 0);
        this._fixedName = _fixedName;
    }
    get dependencies() {
        return [];
    }
    addAssociate(_) {
        return Support_1.panic("Cannot add associates to fixed names");
    }
    get fixedName() {
        return this._fixedName;
    }
    proposeUnstyledNames(_) {
        return Support_1.panic("Only fixedName should be called on FixedName.");
    }
}
exports.FixedName = FixedName;
class SimpleName extends Name {
    constructor(unstyledNames, namingFunction, order) {
        super(namingFunction, order);
        this._unstyledNames = new Set(unstyledNames);
    }
    get dependencies() {
        return [];
    }
    proposeUnstyledNames(_) {
        return this._unstyledNames;
    }
}
exports.SimpleName = SimpleName;
class AssociatedName extends Name {
    constructor(_sponsor, order, getName) {
        super(undefined, order);
        this._sponsor = _sponsor;
        this.getName = getName;
    }
    get dependencies() {
        return [this._sponsor];
    }
    proposeUnstyledNames(_) {
        return Support_1.panic("AssociatedName must be assigned via its sponsor");
    }
}
exports.AssociatedName = AssociatedName;
class DependencyName extends Name {
    constructor(namingFunction, order, _proposeUnstyledName) {
        super(namingFunction, order);
        this._proposeUnstyledName = _proposeUnstyledName;
        const dependencies = [];
        _proposeUnstyledName(n => {
            dependencies.push(n);
            return "0xDEADBEEF";
        });
        this._dependencies = new Set(dependencies);
    }
    get dependencies() {
        return Array.from(this._dependencies);
    }
    proposeUnstyledNames(names) {
        return new Set([
            this._proposeUnstyledName(n => {
                Support_1.assert(this._dependencies.has(n), "DependencyName proposer is not pure");
                return Support_1.defined(names.get(n));
            })
        ]);
    }
}
exports.DependencyName = DependencyName;
function keywordNamespace(name, keywords) {
    const ns = new Namespace(name, undefined, [], []);
    for (const kw of keywords) {
        ns.add(new FixedName(kw));
    }
    return ns;
}
exports.keywordNamespace = keywordNamespace;
function allNamespacesRecursively(namespaces) {
    return collection_utils_1.setUnion(namespaces, ...Array.from(collection_utils_1.setMap(namespaces, ns => allNamespacesRecursively(ns.children))));
}
class NamingContext {
    constructor(rootNamespaces) {
        this._names = new Map();
        this._namedsForName = new Map();
        this.isReadyToBeNamed = (named) => {
            if (this._names.has(named))
                return false;
            return named.dependencies.every((n) => this._names.has(n));
        };
        this.isConflicting = (namedNamespace, proposed) => {
            const namedsForProposed = this._namedsForName.get(proposed);
            // If the name is not assigned at all, there is no conflict.
            if (namedsForProposed === undefined)
                return false;
            // The name is assigned, but it might still not be forbidden.
            for (const n of namedsForProposed) {
                if (namedNamespace.members.has(n) || namedNamespace.forbiddenNameds.has(n)) {
                    return true;
                }
            }
            return false;
        };
        this.assign = (named, namedNamespace, name) => {
            Support_1.assert(!this.names.has(named), `Name "${name}" assigned twice`);
            Support_1.assert(!this.isConflicting(namedNamespace, name), `Assigned name "${name}" conflicts`);
            this._names.set(named, name);
            let namedsForName = this._namedsForName.get(name);
            if (namedsForName === undefined) {
                namedsForName = new Set();
                this._namedsForName.set(name, namedsForName);
            }
            namedsForName.add(named);
        };
        this.namespaces = allNamespacesRecursively(rootNamespaces);
    }
    get names() {
        return this._names;
    }
    areForbiddensFullyNamed(namespace) {
        return collection_utils_1.iterableEvery(namespace.forbiddenNameds, n => this._names.has(n));
    }
}
// Naming algorithm
function assignNames(rootNamespaces) {
    const ctx = new NamingContext(rootNamespaces);
    // Assign all fixed names.
    for (const ns of ctx.namespaces) {
        for (const n of ns.members) {
            if (!n.isFixed())
                continue;
            ctx.assign(n, ns, n.fixedName);
        }
    }
    for (;;) {
        // 1. Find a namespace whose forbiddens are all fully named, and which has
        //    at least one unnamed Named that has all its dependencies satisfied.
        //    If no such namespace exists we're either done, or there's an unallowed
        //    cycle.
        const unfinishedNamespaces = collection_utils_1.setFilter(ctx.namespaces, ns => ctx.areForbiddensFullyNamed(ns));
        const readyNamespace = collection_utils_1.iterableFind(unfinishedNamespaces, ns => collection_utils_1.iterableSome(ns.members, ctx.isReadyToBeNamed));
        if (readyNamespace === undefined) {
            // FIXME: Check for cycles?
            return ctx.names;
        }
        const allForbiddenNames = collection_utils_1.setUnion(readyNamespace.members, readyNamespace.forbiddenNameds);
        let forbiddenNames = collection_utils_1.setFilterMap(allForbiddenNames, n => ctx.names.get(n));
        // 2. From low order to high order, sort those names into sets where all
        //    members of a set propose the same name and have the same naming
        //    function.
        for (;;) {
            const allReadyNames = collection_utils_1.setFilter(readyNamespace.members, ctx.isReadyToBeNamed);
            const minOrderName = collection_utils_1.iterableMinBy(allReadyNames, n => n.order);
            if (minOrderName === undefined)
                break;
            const minOrder = minOrderName.order;
            const readyNames = collection_utils_1.setFilter(allReadyNames, n => n.order === minOrder);
            // It would be nice if we had tuples, then we wouldn't have to do this in
            // two steps.
            const byNamingFunction = collection_utils_1.setGroupBy(readyNames, n => n.namingFunction);
            for (const [namer, namedsForNamingFunction] of byNamingFunction) {
                const byProposed = collection_utils_1.setGroupBy(namedsForNamingFunction, n => n.namingFunction.nameStyle(n.firstProposedName(ctx.names)));
                for (const [, nameds] of byProposed) {
                    // 3. Use each set's naming function to name its members.
                    const names = namer.assignNames(ctx.names, forbiddenNames, nameds);
                    for (const [name, assigned] of names) {
                        ctx.assign(name, readyNamespace, assigned);
                    }
                    collection_utils_1.setUnionInto(forbiddenNames, names.values());
                }
            }
        }
    }
}
exports.assignNames = assignNames;

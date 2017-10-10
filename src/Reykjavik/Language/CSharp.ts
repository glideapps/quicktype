"use strict";

import { Set, List, Map, OrderedSet, Range } from "immutable";
import {
    Graph,
    Type,
    NamedType,
    ClassType,
    UnionType,
    allClassesAndUnions
} from "../Type";
import { Source, Sourcelike, newline } from "../Source";
import { legalizeCharacters, camelCase, startWithLetter } from "../Utils";
import {
    Namespace,
    Named,
    SimpleNamed,
    DependencyNamed,
    NamingFunction,
    keywordNamespace,
    assignNames
} from "../Naming";
import { Renderer } from "../Renderer";

const unicode = require("unicode-properties");

const forbiddenNames = [
    "QuickType",
    "Converter",
    "JsonConverter",
    "Type",
    "Serialize"
];

class CountingNamingFunction extends NamingFunction {
    name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string> {
        if (numberOfNames < 1) {
            throw "Number of names can't be less than 1";
        }

        const range = Range(0, numberOfNames);
        let underscores = "";
        for (;;) {
            let names: OrderedSet<string>;
            if (numberOfNames === 1) {
                names = OrderedSet([proposedName + underscores]);
            } else {
                names = range
                    .map(i => proposedName + underscores + i)
                    .toOrderedSet();
            }
            if (names.some((n: string) => forbiddenNames.has(n))) {
                underscores += "_";
                continue;
            }
            return names;
        }
    }

    equals(other: any): boolean {
        return other instanceof CountingNamingFunction;
    }

    hashCode(): number {
        return 31415;
    }
}

const countingNamingFunction = new CountingNamingFunction();

function proposeTopLevelDependencyName(names: List<string>): string {
    if (names.size !== 1) throw "Cannot deal with more than one dependency";
    return names.first();
}

function isStartCharacter(c: string): boolean {
    const code = c.charCodeAt(0);
    if (unicode.isAlphabetic(code)) {
        return true;
    }
    return c == "_";
}

function isPartCharacter(c: string): boolean {
    const category: string = unicode.getCategory(c.charCodeAt(0));
    if (["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0) {
        return true;
    }
    return isStartCharacter(c);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function csNameStyle(original: string): string {
    const legalized = legalizeName(original);
    const cameled = camelCase(legalized);
    return startWithLetter(isStartCharacter, true, cameled);
}

export class CSharpRenderer extends Renderer {
    readonly globalNamespace: Namespace;
    readonly topLevelNameds: Map<string, Named>;
    readonly classes: Set<ClassType>;
    readonly unions: Set<UnionType>;
    classAndUnionNameds: Map<NamedType, Named>;
    propertyNameds: Map<ClassType, Map<string, Named>>;
    readonly names: Map<Named, string>;

    constructor(topLevels: Graph) {
        super(topLevels);
        this.globalNamespace = keywordNamespace("global", forbiddenNames);
        const { classes, unions } = allClassesAndUnions(topLevels);
        this.classes = classes;
        this.unions = unions;
        this.classAndUnionNameds = Map();
        this.propertyNameds = Map();
        this.topLevelNameds = topLevels.map(this.namedFromTopLevel).toMap();
        classes.forEach((c: ClassType) => {
            this.addClassOrUnionNamed(c);
            this.addPropertyNameds(c);
        });
        unions.forEach((c: UnionType) => this.addClassOrUnionNamed(c));
        this.globalNamespace.members.forEach((n: Named) => console.log(n.name));
        this.names = assignNames(OrderedSet([this.globalNamespace]));
    }

    namedFromTopLevel = (type: Type, name: string): SimpleNamed => {
        const proposed = csNameStyle(name);
        const named = new SimpleNamed(
            this.globalNamespace,
            name,
            countingNamingFunction,
            proposed
        );
        if (type instanceof NamedType) {
            const typeNamed = new DependencyNamed(
                this.globalNamespace,
                name,
                countingNamingFunction,
                List([named]),
                proposeTopLevelDependencyName
            );
            this.classAndUnionNameds = this.classAndUnionNameds.set(
                type,
                typeNamed
            );
        }
        return named;
    };

    addClassOrUnionNamed = (type: NamedType): void => {
        if (this.classAndUnionNameds.has(type)) {
            return;
        }
        const name = type.names.combined;
        const named = new SimpleNamed(
            this.globalNamespace,
            name,
            countingNamingFunction,
            csNameStyle(name)
        );
        this.classAndUnionNameds = this.classAndUnionNameds.set(type, named);
    };

    addPropertyNameds = (c: ClassType): void => {
        const ns = new Namespace(c.names.combined, this.globalNamespace, Set());
        const nameds = c.properties
            .map((t: Type, name: string) => {
                return new SimpleNamed(
                    ns,
                    name,
                    countingNamingFunction,
                    csNameStyle(name)
                );
            })
            .toMap();
        this.propertyNameds = this.propertyNameds.set(c, nameds);
    };

    emitBlock = (f: () => void): void => {
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}");
    };

    emitClass = (c: ClassType): void => {
        const propertyNameds = this.propertyNameds.get(c);
        this.emitLine(["public class ", this.classAndUnionNameds.get(c)]);
        this.emitBlock(() => {
            c.properties.forEach((t: Type, name: string) => {
                const named = propertyNameds.get(name);
                this.emitLine(named);
            });
        });
    };

    render(): Source {
        this.emitLine("namespace QuickType");
        this.emitBlock(() => {
            this.classes.forEach((c: ClassType) => this.emitClass(c));
        });
        return this.finishedSource();
        /*
        return this.names
            .map((name: string, named: Named) => [
                named.name,
                ": ",
                name,
                " - ",
                named,
                newline()
            ])
            .toArray();
            */
    }
}

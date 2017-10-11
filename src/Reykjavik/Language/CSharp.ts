"use strict";

import { Set, List, Map, OrderedSet, Range, Iterable } from "immutable";
import {
    Graph,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    UnionType,
    NamedType,
    ClassType,
    nullableFromUnion,
    removeNullFromUnion,
    allClassesAndUnions
} from "../Type";
import { Source, Sourcelike, newline } from "../Source";
import { legalizeCharacters, camelCase, startWithLetter, stringEscape } from "../Utils";
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

const forbiddenNames = ["QuickType", "Converter", "JsonConverter", "Type", "Serialize"];

class CountingNamingFunction extends NamingFunction {
    name(
        proposedName: string,
        forbiddenNames: Set<string>,
        numberOfNames: number
    ): OrderedSet<string> {
        if (numberOfNames < 1) {
            throw "Number of names can't be less than 1";
        }

        const range = Range(1, numberOfNames + 1);
        let underscores = "";
        for (;;) {
            let names: OrderedSet<string>;
            if (numberOfNames === 1) {
                names = OrderedSet([proposedName + underscores]);
            } else {
                names = range.map(i => proposedName + underscores + i).toOrderedSet();
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

function isValueType(t: Type): boolean {
    if (t instanceof PrimitiveType) {
        return ["integer", "double", "bool"].indexOf(t.kind) >= 0;
    }
    return false;
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
        // FIXME: only non-nullable unions!
        unions.forEach((u: UnionType) => {
            if (nullableFromUnion(u)) return;
            this.addClassOrUnionNamed(u);
        });
        this.globalNamespace.members.forEach((n: Named) => console.log(n.name));
        this.names = assignNames(OrderedSet([this.globalNamespace]));
    }

    namedFromTopLevel = (type: Type, name: string): SimpleNamed => {
        const proposed = csNameStyle(name);
        const named = new SimpleNamed(this.globalNamespace, name, countingNamingFunction, proposed);
        if (type instanceof NamedType) {
            const typeNamed = new DependencyNamed(
                this.globalNamespace,
                name,
                countingNamingFunction,
                List([named]),
                proposeTopLevelDependencyName
            );
            this.classAndUnionNameds = this.classAndUnionNameds.set(type, typeNamed);
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
                return new SimpleNamed(ns, name, countingNamingFunction, csNameStyle(name));
            })
            .toMap();
        this.propertyNameds = this.propertyNameds.set(c, nameds);
    };

    emitBlock = (f: () => void, semicolon: boolean = false): void => {
        this.emitLine("{");
        this.indent(f);
        this.emitLine(["}", semicolon ? ";" : ""]);
    };

    forEachWithBlankLines<K, V>(iterable: Iterable<K, V>, emitter: (v: V, k: K) => void): void {
        let needBlank = false;
        iterable.forEach((v: V, k: K) => {
            if (needBlank) {
                this.emitNewline();
            }
            emitter(v, k);
            needBlank = true;
        });
    }

    csType = (t: Type): Sourcelike => {
        if (t instanceof PrimitiveType) {
            switch (t.kind) {
                case "any":
                    return "object"; // FIXME: add issue annotation
                case "null":
                    return "object"; // FIXME: add issue annotation
                case "bool":
                    return "bool";
                case "integer":
                    return "long";
                case "double":
                    return "double";
                case "string":
                    return "string";
            }
        } else if (t instanceof ArrayType) {
            return [this.csType(t.items), "[]"];
        } else if (t instanceof ClassType) {
            return this.classAndUnionNameds.get(t);
        } else if (t instanceof MapType) {
            return ["Dictionary<string, ", this.csType(t.values), ">"];
        } else if (t instanceof UnionType) {
            const nonNull = nullableFromUnion(t);
            if (nonNull) return this.nullableCSType(nonNull);
            return this.classAndUnionNameds.get(t);
        }
        throw "Unknown type";
    };

    typeNameForUnionMember = (t: Type): string => {
        if (t instanceof PrimitiveType) {
            switch (t.kind) {
                case "any":
                    return "anything";
                case "null":
                    return "null";
                case "bool":
                    return "bool";
                case "integer":
                    return "long";
                case "double":
                    return "double";
                case "string":
                    return "string";
            }
        } else if (t instanceof ArrayType) {
            return this.typeNameForUnionMember(t.items) + "_array";
        } else if (t instanceof ClassType) {
            return this.names.get(this.classAndUnionNameds.get(t));
        } else if (t instanceof MapType) {
            return this.typeNameForUnionMember(t.values), "_map";
        } else if (t instanceof UnionType) {
            return "union";
        }
        throw "Unknown type";
    };

    nullableCSType = (t: Type): Sourcelike => {
        const csType = this.csType(t);
        if (isValueType(t)) {
            return [csType, "?"];
        } else {
            return csType;
        }
    };

    emitClass = (declaration: Sourcelike, name: Sourcelike, emitter: () => void): void => {
        this.emitLine(["public ", declaration, " ", name]);
        this.emitBlock(emitter);
    };

    emitClassDefinition = (c: ClassType): void => {
        const propertyNameds = this.propertyNameds.get(c);
        this.emitClass("partial class", this.classAndUnionNameds.get(c), () => {
            this.forEachWithBlankLines(c.properties, (t: Type, name: string) => {
                const named = propertyNameds.get(name);
                this.emitLine(['[JsonProperty("', stringEscape(name), '")]']);
                this.emitLine(["public ", this.csType(t), " ", named, " { get; set; }"]);
            });
        });
    };

    unionFieldName = (t: Type): string => {
        return csNameStyle(this.typeNameForUnionMember(t));
    };

    emitUnionDefinition = (c: UnionType): void => {
        const [_, nonNulls] = removeNullFromUnion(c);
        this.emitClass("partial struct", this.classAndUnionNameds.get(c), () => {
            nonNulls.forEach((t: Type) => {
                const csType = this.nullableCSType(t);
                const field = this.unionFieldName(t);
                this.emitLine(["public ", csType, " ", field, ";"]);
            });
        });
    };

    emitExpressionMember(declare: Sourcelike, define: Sourcelike): void {
        this.emitLine([declare, " => ", define, ";"]);
    }

    emitTopLevelJSONPartial = (t: Type, name: string): void => {
        const csType = this.csType(t);
        this.emitClass("partial class", this.topLevelNameds.get(name), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonConvert.DeserializeObject<", csType, ">(json, Converter.Settings)"]
            );
        });
    };

    emitSerializeClass = (): void => {
        // FIXME: Make Serialize a Named
        this.emitClass("static class", "Serialize", () => {
            this.topLevels.forEach((t: Type, name: string) => {
                // FIXME: Make ToJson a Named
                this.emitExpressionMember(
                    ["public static string ToJson(this ", this.csType(t), " self)"],
                    "JsonConvert.SerializeObject(self, Converter.Settings)"
                );
            });
        });
    };

    emitConverterClass = (): void => {
        this.emitClass("class", "Converter", () => {
            this.emitLine(
                "public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings"
            );
            this.emitBlock(() => {
                this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                this.emitLine("DateParseHandling = DateParseHandling.None,");
            }, true);
        });
    };

    render(): Source {
        // FIXME: Use configurable namespace
        this.emitLine("namespace QuickType");
        this.emitBlock(() => {
            this.forEachWithBlankLines(this.classes, this.emitClassDefinition);
            this.emitNewline();
            this.forEachWithBlankLines(this.unions, (u: UnionType): void => {
                if (nullableFromUnion(u)) return;
                this.emitUnionDefinition(u);
            });
            this.emitNewline();
            this.topLevels.forEach(this.emitTopLevelJSONPartial);
            this.emitNewline();
            this.emitSerializeClass();
            this.emitNewline();
            this.emitConverterClass();
        });
        return this.finishedSource();
    }
}

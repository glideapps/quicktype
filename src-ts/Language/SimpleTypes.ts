"use strict";

import * as _ from "lodash";

import { Set, List, Map, OrderedSet, Iterable } from "immutable";

import {
    TopLevels,
    Type,
    PrimitiveType,
    ArrayType,
    MapType,
    UnionType,
    NamedType,
    ClassType,
    nullableFromUnion,
    removeNullFromUnion,
    allClassesAndUnions,
    matchTypeAll
} from "../Type";

import { Source, Sourcelike, newline } from "../Source";

import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    stringEscape,
    intercalate
} from "../Support";

import { Namespace, Name, SimpleName, FixedName, keywordNamespace } from "../Naming";

import { PrimitiveTypeKind, TypeKind } from "Reykjavik";
import { Renderer, RenderResult } from "../Renderer";
import { TargetLanguage, TypeScriptTargetLanguage } from "../TargetLanguage";

const unicode = require("unicode-properties");

export default class SimpleTypesTargetLanguage extends TypeScriptTargetLanguage {
    constructor() {
        super("Simple Types", ["types"], "txt", []);
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        return new SimpleTypesRenderer(topLevels).render();
    }
}

const forbiddenNames = ["QuickType", "Converter", "JsonConverter", "Type", "Serialize"];

function isStartCharacter(c: string): boolean {
    return unicode.isAlphabetic(c.charCodeAt(0)) || c == "_";
}

function isPartCharacter(c: string): boolean {
    const category: string = unicode.getCategory(c.charCodeAt(0));
    return _.includes(["Nd", "Pc", "Mn", "Mc"], category) || isStartCharacter(c);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    return startWithLetter(isStartCharacter, uppercase, camelCase(legalizeName(original)));
}

class SimpleTypesRenderer extends Renderer {
    namespace: Namespace;
    topLevelNames: Map<string, Name>;
    classAndUnionNames: Map<NamedType, Name>;
    propertyNames: Map<ClassType, Map<string, Name>>;

    protected setUpNaming(): Namespace[] {
        this.namespace = keywordNamespace("global", forbiddenNames);

        const { classes, unions } = allClassesAndUnions(this.topLevels);
        const namedUnions = unions.filter((u: UnionType) => !nullableFromUnion(u)).toSet();

        this.classAndUnionNames = Map();
        this.propertyNames = Map();
        this.topLevelNames = this.topLevels.map(this.namedFromTopLevel).toMap();

        classes.forEach((c: ClassType) => {
            const named = this.addClassOrUnionNamed(c);
            this.addPropertyNameds(c, named);
        });

        namedUnions.forEach((u: UnionType) => this.addClassOrUnionNamed(u));

        return [this.namespace];
    }

    namedFromTopLevel = (type: Type, name: string): FixedName => {
        // FIXME: leave the name as-is?
        const named = new FixedName(this.namespace, simpleNameStyle(name, true));
        const definedTypes = type.directlyReachableNamedTypes;
        if (definedTypes.size > 1) {
            throw "Cannot have more than one defined type per top-level";
        }

        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.

        if (definedTypes.size === 1) {
            const definedType = definedTypes.first();
            this.classAndUnionNames = this.classAndUnionNames.set(definedType, named);
        }

        return named;
    };

    addClassOrUnionNamed = (type: NamedType): Name => {
        if (this.classAndUnionNames.has(type)) {
            return this.classAndUnionNames.get(type);
        }
        const name = type.names.combined;
        const named = new SimpleName(this.namespace, name, simpleNameStyle(name, true));
        this.classAndUnionNames = this.classAndUnionNames.set(type, named);
        return named;
    };

    addPropertyNameds = (c: ClassType, classNamed: Name): void => {
        const ns = new Namespace(c.names.combined, this.namespace, Set(), Set([classNamed]));
        const nameds = c.properties
            .map((t: Type, name: string) => new SimpleName(ns, name, simpleNameStyle(name, false)))
            .toMap();
        this.propertyNames = this.propertyNames.set(c, nameds);
    };

    sourceFor: (t: Type) => Sourcelike = matchTypeAll<Sourcelike>(
        anyType => "Any",
        nullType => "Null",
        boolType => "Bool",
        integerType => "Int",
        doubleType => "Double",
        stringType => "String",
        arrayType => ["List<", this.sourceFor(arrayType.items), ">"],
        classType => this.classAndUnionNames.get(classType),
        mapType => ["Map<String, ", this.sourceFor(mapType.values), ">"],
        unionType => {
            const nullable = nullableFromUnion(unionType);
            if (nullable) return ["Maybe<", this.sourceFor(nullable), ">"];

            const children = unionType.children.map((t: Type) => this.sourceFor(t));
            return intercalate(" | ", children).toArray();
        }
    );

    emitClass = (c: ClassType) => {
        const propertyNames = this.propertyNames.get(c);
        this.emitLine("class ", this.classAndUnionNames.get(c), " {");
        this.indent(() => {
            this.forEach(c.properties, false, false, (t: Type, name: string) => {
                this.emitLine(propertyNames.get(name), ": ", this.sourceFor(t));
            });
        });
        this.emitLine("}");
    };

    childrenOfType = (t: Type): OrderedSet<Type> => {
        if (t instanceof ClassType) {
            const propertyNameds = this.propertyNames.get(t);
            return t.properties
                .sortBy((_, n: string): string => this.names.get(propertyNameds.get(n)))
                .toOrderedSet();
        }
        return t.children.toOrderedSet();
    };

    protected emitSource() {
        const { classes } = allClassesAndUnions(this.topLevels, this.childrenOfType);
        this.forEach(classes, true, false, this.emitClass);
    }
}

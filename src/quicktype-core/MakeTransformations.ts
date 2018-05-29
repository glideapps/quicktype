import { TypeGraph, TypeRef, typeRefIndex } from "./TypeGraph";
import { TargetLanguage } from "./TargetLanguage";
import { UnionType, TypeKind, EnumType, Type } from "./Type";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { StringTypeMapping } from "./TypeBuilder";
import { defined, assert, panic } from "./support/Support";
import {
    UnionInstantiationTransformer,
    DecodingChoiceTransformer,
    Transformation,
    transformationTypeAttributeKind,
    StringMatchTransformer,
    StringProducerTransformer,
    ChoiceTransformer,
    Transformer,
    DecodingTransformer,
    ParseDateTimeTransformer
} from "./Transformers";
import { TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { StringTypes } from "./StringTypes";
import { setFilter, setUnion, iterableFirst, mapMapEntries } from "./support/Containers";

function transformationAttributes(
    graph: TypeGraph,
    reconstitutedTargetType: TypeRef,
    transformer: Transformer,
    debugPrintTransformation: boolean
): TypeAttributes {
    const transformation = new Transformation(graph, reconstitutedTargetType, transformer);
    if (debugPrintTransformation) {
        console.log(`transformation for ${typeRefIndex(reconstitutedTargetType)}:`);
        transformation.debugPrint();
    }
    return transformationTypeAttributeKind.makeAttributes(transformation);
}

function makeEnumTransformer(
    graph: TypeGraph,
    enumType: EnumType,
    stringType: TypeRef,
    continuation?: Transformer
): Transformer {
    const sortedCases = Array.from(enumType.cases).sort();
    const caseTransformers = sortedCases.map(
        c =>
            new StringMatchTransformer(
                graph,
                stringType,
                new StringProducerTransformer(graph, stringType, continuation, c),
                c
            )
    );
    return new ChoiceTransformer(graph, stringType, caseTransformers);
}

function replaceUnion(
    union: UnionType,
    builder: GraphRewriteBuilder<Type>,
    forwardingRef: TypeRef,
    debugPrintTransformations: boolean
): TypeRef {
    const graph = builder.typeGraph;

    assert(union.members.size > 0, "We can't have empty unions");

    const reconstitutedMembersByKind = mapMapEntries(union.members.entries(), m => [
        m.kind,
        builder.reconstituteType(m)
    ]);
    const reconstitutedUnion = builder.getUnionType(
        union.getAttributes(),
        new Set(reconstitutedMembersByKind.values())
    );

    function memberForKind(kind: TypeKind) {
        return defined(reconstitutedMembersByKind.get(kind));
    }

    function transformerForKind(kind: TypeKind) {
        const member = union.findMember(kind);
        if (member === undefined) return undefined;
        const memberTypeRef = defined(reconstitutedMembersByKind.get(kind));
        return new UnionInstantiationTransformer(graph, memberTypeRef);
    }

    let maybeStringType: TypeRef | undefined = undefined;
    function getStringType(): TypeRef {
        if (maybeStringType === undefined) {
            maybeStringType = builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
        }
        return maybeStringType;
    }

    function transformerForStringType(t: Type): Transformer {
        const memberRef = memberForKind(t.kind);
        switch (t.kind) {
            case "string":
                return defined(transformerForKind(t.kind));

            case "date-time":
                return new ParseDateTimeTransformer(
                    graph,
                    getStringType(),
                    new UnionInstantiationTransformer(graph, memberRef)
                );

            case "enum": {
                const enumType = t as EnumType;
                return makeEnumTransformer(
                    graph,
                    enumType,
                    getStringType(),
                    new UnionInstantiationTransformer(graph, memberRef)
                );
            }

            default:
                return panic(`Can't transform string type ${t.kind}`);
        }
    }

    const stringTypes = union.stringTypeMembers;
    let transformerForString: Transformer | undefined;
    if (stringTypes.size === 0) {
        transformerForString = undefined;
    } else if (stringTypes.size === 1) {
        const t = defined(iterableFirst(stringTypes));
        transformerForString = new UnionInstantiationTransformer(graph, memberForKind(t.kind));
    } else {
        transformerForString = new ChoiceTransformer(
            graph,
            getStringType(),
            Array.from(stringTypes).map(transformerForStringType)
        );
    }

    const transformerForClass = transformerForKind("class");
    const transformerForMap = transformerForKind("map");
    assert(
        transformerForClass === undefined || transformerForMap === undefined,
        "Can't have both class and map in a transformed union"
    );
    const transformerForObject = transformerForClass !== undefined ? transformerForClass : transformerForMap;

    const transformer = new DecodingChoiceTransformer(
        graph,
        builder.getPrimitiveType("any"),
        transformerForKind("null"),
        transformerForKind("integer"),
        transformerForKind("double"),
        transformerForKind("bool"),
        transformerForString,
        transformerForKind("array"),
        transformerForObject
    );
    const attributes = transformationAttributes(graph, reconstitutedUnion, transformer, debugPrintTransformations);
    return builder.getPrimitiveType("any", attributes, forwardingRef);
}

function replaceEnum(
    enumType: EnumType,
    builder: GraphRewriteBuilder<Type>,
    forwardingRef: TypeRef,
    debugPrintTransformations: boolean
): TypeRef {
    const stringType = builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
    const transformer = new DecodingTransformer(
        builder.typeGraph,
        stringType,
        makeEnumTransformer(builder.typeGraph, enumType, stringType)
    );
    const reconstitutedEnum = builder.getEnumType(enumType.getAttributes(), enumType.cases);
    const attributes = transformationAttributes(
        builder.typeGraph,
        reconstitutedEnum,
        transformer,
        debugPrintTransformations
    );
    return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
}

export function makeTransformations(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    targetLanguage: TargetLanguage,
    debugPrintTransformations: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    function replace(
        setOfOneUnion: ReadonlySet<Type>,
        builder: GraphRewriteBuilder<Type>,
        forwardingRef: TypeRef
    ): TypeRef {
        const t = defined(iterableFirst(setOfOneUnion));
        if (t instanceof UnionType) {
            return replaceUnion(t, builder, forwardingRef, debugPrintTransformations);
        }
        if (t instanceof EnumType) {
            return replaceEnum(t, builder, forwardingRef, debugPrintTransformations);
        }
        return panic(`Cannot make transformation for type ${t.kind}`);
    }

    const allTypesUnordered = graph.allTypesUnordered();
    const unions = setFilter(
        allTypesUnordered,
        t => t instanceof UnionType && targetLanguage.needsTransformerForUnion(t)
    );
    const enums = targetLanguage.needsTransformerForEnums
        ? setFilter(allTypesUnordered, t => t instanceof EnumType)
        : new Set();
    const groups = Array.from(setUnion(unions, enums)).map(t => [t]);
    return graph.rewrite("make-transformations", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}

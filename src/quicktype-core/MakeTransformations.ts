import { setFilter, iterableFirst, mapMapEntries } from "collection-utils";

import { TypeGraph, TypeRef, typeRefIndex } from "./TypeGraph";
import { TargetLanguage } from "./TargetLanguage";
import { UnionType, TypeKind, EnumType, Type, ArrayType, PrimitiveType } from "./Type";
import { GraphRewriteBuilder } from "./GraphRewriting";
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
    ParseDateTimeTransformer,
    ParseIntegerTransformer,
    ArrayDecodingTransformer
} from "./Transformers";
import { TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { StringTypes } from "./StringTypes";
import { RunContext } from "./Run";

function transformationAttributes(
    graph: TypeGraph,
    reconstitutedTargetType: TypeRef,
    transformer: Transformer,
    debugPrintTransformations: boolean
): TypeAttributes {
    const transformation = new Transformation(graph, reconstitutedTargetType, transformer);
    if (debugPrintTransformations) {
        console.log(`transformation for ${typeRefIndex(reconstitutedTargetType)}:`);
        transformation.debugPrint();
        console.log(`reverse:`);
        transformation.reverse.debugPrint();
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

    const integerMember = union.findMember("integer");

    function reconstituteMember(t: Type): TypeRef {
        // Special handling for integer-string: The type in the union must
        // be "integer", so if one already exists, use that one, otherwise
        // make a new one.
        if (t.kind === "integer-string") {
            if (integerMember !== undefined) {
                return builder.reconstituteType(integerMember);
            }
            return builder.getPrimitiveType("integer");
        }
        return builder.reconstituteType(t);
    }

    const reconstitutedMembersByKind = mapMapEntries(union.members.entries(), m => [m.kind, reconstituteMember(m)]);
    const reconstitutedMemberSet = new Set(reconstitutedMembersByKind.values());
    const haveUnion = reconstitutedMemberSet.size > 1;
    const reconstitutedTargetType = haveUnion
        ? builder.getUnionType(union.getAttributes(), reconstitutedMemberSet)
        : defined(iterableFirst(reconstitutedMemberSet));

    function memberForKind(kind: TypeKind) {
        return defined(reconstitutedMembersByKind.get(kind));
    }

    function consumer(memberTypeRef: TypeRef): Transformer | undefined {
        if (!haveUnion) return undefined;
        return new UnionInstantiationTransformer(graph, memberTypeRef);
    }

    function transformerForKind(kind: TypeKind) {
        const member = union.findMember(kind);
        if (member === undefined) return undefined;
        const memberTypeRef = memberForKind(kind);
        return new DecodingTransformer(graph, memberTypeRef, consumer(memberTypeRef));
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
                return new ParseDateTimeTransformer(graph, getStringType(), consumer(memberRef));

            case "enum": {
                const enumType = t as EnumType;
                return makeEnumTransformer(graph, enumType, getStringType(), consumer(memberRef));
            }

            case "integer-string":
                return new ParseIntegerTransformer(graph, getStringType(), consumer(memberRef));

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
        transformerForString = new DecodingTransformer(graph, getStringType(), transformerForStringType(t));
    } else {
        transformerForString = new DecodingTransformer(
            graph,
            getStringType(),
            new ChoiceTransformer(graph, getStringType(), Array.from(stringTypes).map(transformerForStringType))
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
    const attributes = transformationAttributes(graph, reconstitutedTargetType, transformer, debugPrintTransformations);
    return builder.getPrimitiveType("any", attributes, forwardingRef);
}

function replaceArray(
    arrayType: ArrayType,
    builder: GraphRewriteBuilder<Type>,
    forwardingRef: TypeRef,
    debugPrintTransformations: boolean
): TypeRef {
    const anyType = builder.getPrimitiveType("any");
    const anyArrayType = builder.getArrayType(emptyTypeAttributes, anyType);
    const reconstitutedItems = builder.reconstituteType(arrayType.items);
    const transformer = new ArrayDecodingTransformer(
        builder.typeGraph,
        anyArrayType,
        undefined,
        reconstitutedItems,
        new DecodingTransformer(builder.typeGraph, anyType, undefined)
    );

    const reconstitutedArray = builder.getArrayType(
        builder.reconstituteTypeAttributes(arrayType.getAttributes()),
        reconstitutedItems
    );

    const attributes = transformationAttributes(
        builder.typeGraph,
        reconstitutedArray,
        transformer,
        debugPrintTransformations
    );

    return builder.getArrayType(attributes, anyType, forwardingRef);
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

function replaceIntegerString(
    t: PrimitiveType,
    builder: GraphRewriteBuilder<Type>,
    forwardingRef: TypeRef,
    debugPrintTransformations: boolean
): TypeRef {
    const stringType = builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
    const transformer = new DecodingTransformer(
        builder.typeGraph,
        stringType,
        new ParseIntegerTransformer(builder.typeGraph, stringType, undefined)
    );
    const attributes = transformationAttributes(
        builder.typeGraph,
        builder.getPrimitiveType("integer", builder.reconstituteTypeAttributes(t.getAttributes())),
        transformer,
        debugPrintTransformations
    );
    return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
}

export function makeTransformations(ctx: RunContext, graph: TypeGraph, targetLanguage: TargetLanguage): TypeGraph {
    function replace(
        setOfOneUnion: ReadonlySet<Type>,
        builder: GraphRewriteBuilder<Type>,
        forwardingRef: TypeRef
    ): TypeRef {
        const t = defined(iterableFirst(setOfOneUnion));
        if (t instanceof UnionType) {
            return replaceUnion(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (t instanceof ArrayType) {
            return replaceArray(t, builder, forwardingRef, ctx.debugPrintReconstitution);
        }
        if (t instanceof EnumType) {
            return replaceEnum(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (t instanceof PrimitiveType && t.kind === "integer-string") {
            return replaceIntegerString(t, builder, forwardingRef, ctx.debugPrintReconstitution);
        }
        return panic(`Cannot make transformation for type ${t.kind}`);
    }

    const transformedTypes = setFilter(graph.allTypesUnordered(), t => targetLanguage.needsTransformerForType(t));
    const groups = Array.from(transformedTypes).map(t => [t]);
    return graph.rewrite(
        "make-transformations",
        ctx.stringTypeMapping,
        false,
        groups,
        ctx.debugPrintReconstitution,
        replace
    );
}

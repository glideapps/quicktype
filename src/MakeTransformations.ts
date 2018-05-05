import { Set } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { TargetLanguage } from "./TargetLanguage";
import { UnionType, TypeKind, EnumType, Type } from "./Type";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { TypeRef, StringTypeMapping } from "./TypeBuilder";
import { defined, assert, panic } from "./Support";
import {
    UnionInstantiationTransformer,
    DecodingChoiceTransformer,
    Transformation,
    transformationTypeAttributeKind,
    StringMatchTransformer,
    StringProducerTransformer,
    ChoiceTransformer,
    Transformer,
    DecodingTransformer
} from "./Transformers";
import { TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { StringTypes } from "./StringTypes";

function transformationAttributes(reconstitutedTargetType: TypeRef, transformer: Transformer): TypeAttributes {
    const transformation = new Transformation(reconstitutedTargetType, transformer);
    return transformationTypeAttributeKind.makeAttributes(transformation);
}

function replaceUnion(union: UnionType, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef) {
    assert(!union.members.isEmpty(), "We can't have empty unions");
    // FIXME: Can we use forceReconstituteType here?
    const reconstitutedUnion = builder.getUnionType(
        union.getAttributes(),
        union.members.map(m => builder.reconstituteType(m))
    );

    function transformerForKind(kind: TypeKind) {
        const member = union.findMember(kind);
        if (member === undefined) return undefined;
        return new UnionInstantiationTransformer(builder.reconstituteType(member));
    }

    const transformerForClass = transformerForKind("class");
    const transformerForMap = transformerForKind("map");
    assert(
        transformerForClass === undefined || transformerForMap === undefined,
        "Can't have both class and map in a transformed union"
    );
    const transformerForObject = transformerForClass !== undefined ? transformerForClass : transformerForMap;

    const transformer = new DecodingChoiceTransformer(
        builder.getPrimitiveType("any"),
        transformerForKind("null"),
        transformerForKind("integer"),
        transformerForKind("double"),
        transformerForKind("bool"),
        transformerForKind("string"),
        transformerForKind("array"),
        transformerForObject
    );
    const attributes = transformationAttributes(reconstitutedUnion, transformer);
    return builder.getPrimitiveType("any", attributes, forwardingRef);
}

function replaceEnum(enumType: EnumType, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef) {
    const stringType = builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
    const caseTransformers = enumType.cases
        .toList()
        .map(c => new StringMatchTransformer(stringType, new StringProducerTransformer(stringType, undefined, c), c));
    const transformer = new DecodingTransformer(stringType, new ChoiceTransformer(stringType, caseTransformers));

    const reconstitutedEnum = builder.getEnumType(enumType.getAttributes(), enumType.cases);
    const attributes = transformationAttributes(reconstitutedEnum, transformer);
    return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
}

function replace(setOfOneUnion: Set<Type>, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef): TypeRef {
    const t = defined(setOfOneUnion.first());
    if (t instanceof UnionType) {
        return replaceUnion(t, builder, forwardingRef);
    }
    if (t instanceof EnumType) {
        return replaceEnum(t, builder, forwardingRef);
    }
    return panic(`Cannot make transformation for type ${t.kind}`);
}

export function makeTransformations(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    targetLanguage: TargetLanguage,
    debugPrintReconstitution: boolean
): TypeGraph {
    const allTypesUnordered = graph.allTypesUnordered();
    const unions = allTypesUnordered.filter(t => t instanceof UnionType && targetLanguage.needsTransformerForUnion(t));
    const enums = targetLanguage.needsTransformerForEnums
        ? allTypesUnordered.filter(t => t instanceof EnumType)
        : Set();
    const groups = unions
        .union(enums)
        .toArray()
        .map(t => [t]);
    return graph.rewrite("make-transformatios", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}

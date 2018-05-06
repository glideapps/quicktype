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
    DecodingTransformer,
    ParseDateTimeTransformer
} from "./Transformers";
import { TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { StringTypes } from "./StringTypes";

function transformationAttributes(reconstitutedTargetType: TypeRef, transformer: Transformer): TypeAttributes {
    const transformation = new Transformation(reconstitutedTargetType, transformer);
    return transformationTypeAttributeKind.makeAttributes(transformation);
}

function makeEnumTransformer(enumType: EnumType, stringType: TypeRef, continuation?: Transformer): Transformer {
    const caseTransformers = enumType.cases
        .toList()
        .map(
            c => new StringMatchTransformer(stringType, new StringProducerTransformer(stringType, continuation, c), c)
        );
    return new ChoiceTransformer(stringType, caseTransformers);
}

function replaceUnion(union: UnionType, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef) {
    assert(!union.members.isEmpty(), "We can't have empty unions");

    const reconstitutedMembersByKind = union.members
        .toOrderedMap()
        .mapKeys(m => m.kind)
        .map(m => builder.reconstituteType(m));
    const reconstitutedUnion = builder.getUnionType(union.getAttributes(), reconstitutedMembersByKind.toOrderedSet());

    function memberForKind(kind: TypeKind) {
        return defined(reconstitutedMembersByKind.get(kind));
    }

    function transformerForKind(kind: TypeKind) {
        const member = union.findMember(kind);
        if (member === undefined) return undefined;
        const memberTypeRef = defined(reconstitutedMembersByKind.get(kind));
        return new UnionInstantiationTransformer(memberTypeRef);
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
                return new ParseDateTimeTransformer(getStringType(), new UnionInstantiationTransformer(memberRef));

            case "enum": {
                const enumType = t as EnumType;
                return makeEnumTransformer(enumType, getStringType(), new UnionInstantiationTransformer(memberRef));
            }

            default:
                return panic(`Can't transform string type ${t.kind}`);
        }
    }

    const stringTypes = union.stringTypeMembers;
    let transformerForString: Transformer | undefined;
    if (stringTypes.isEmpty()) {
        transformerForString = undefined;
    } else if (stringTypes.size === 1) {
        const t = defined(stringTypes.first());
        transformerForString = new UnionInstantiationTransformer(memberForKind(t.kind));
    } else {
        transformerForString = new ChoiceTransformer(
            getStringType(),
            stringTypes.toList().map(transformerForStringType)
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
        builder.getPrimitiveType("any"),
        transformerForKind("null"),
        transformerForKind("integer"),
        transformerForKind("double"),
        transformerForKind("bool"),
        transformerForString,
        transformerForKind("array"),
        transformerForObject
    );
    const attributes = transformationAttributes(reconstitutedUnion, transformer);
    return builder.getPrimitiveType("any", attributes, forwardingRef);
}

function replaceEnum(enumType: EnumType, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef) {
    const stringType = builder.getStringType(emptyTypeAttributes, StringTypes.unrestricted);
    const transformer = new DecodingTransformer(stringType, makeEnumTransformer(enumType, stringType));
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

/*
function gatherTypesToTransform(targetLanguage: TargetLanguage, queue: List<Type>): Type[] {
    let typesDone: Set<Type> = Set();
    const typesToTransform: Type[] = [];

    for (;;) {
        const first = queue.first();
        if (first === undefined) break;
        queue = queue.rest();

        if (typesDone.has(first)) continue;
        typesDone = typesDone.add(first);

        if (first instanceof UnionType && targetLanguage.needsTransformerForUnion(first)) {
            typesToTransform.push(first);

            const stringMembers = first.stringTypeMembers;
            if (stringMembers.size > 1) {
                // This is a bit ugly.  The string members of the union will be transformed
                // by the union transformation, so we must not 
                queue = queue.concat(first.members.filterNot(t => stringMembers.has(t)));
            }
        } else if (first instanceof EnumType && targetLanguage.needsTransformerForEnums) {
            typesToTransform.push(first);
        }
        // FIXME: handle date/time transformation

        queue = queue.concat(first.getChildren());
    }
}
*/

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

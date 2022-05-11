import { UnionType, Type, EnumType, PrimitiveType } from "./Type";
import { TypeAttributeKind } from "./attributes/TypeAttributes";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";
import { TypeRef, TypeGraph } from "./TypeGraph";
export declare abstract class Transformer {
    readonly kind: string;
    protected readonly graph: TypeGraph;
    readonly sourceTypeRef: TypeRef;
    constructor(kind: string, graph: TypeGraph, sourceTypeRef: TypeRef);
    readonly sourceType: Type;
    /** This must return a newly constructed set. */
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    abstract readonly canFail: boolean;
    abstract reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    abstract reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugDescription(): string;
    protected debugPrintContinuations(_indent: number): void;
    debugPrint(indent: number): void;
}
export declare abstract class ProducerTransformer extends Transformer {
    readonly consumer: Transformer | undefined;
    constructor(kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined);
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugPrintContinuations(indent: number): void;
}
export declare abstract class MatchTransformer extends Transformer {
    readonly transformer: Transformer;
    constructor(kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer);
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugPrintContinuations(indent: number): void;
}
export declare class DecodingTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class EncodingTransformer extends Transformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef);
    readonly canFail: boolean;
    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class ArrayDecodingTransformer extends ProducerTransformer {
    private readonly _itemTargetTypeRef;
    readonly itemTransformer: Transformer;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, _itemTargetTypeRef: TypeRef, itemTransformer: Transformer);
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    readonly canFail: boolean;
    readonly itemTargetType: Type;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    hashCode(): number;
    equals(other: any): boolean;
    protected debugPrintContinuations(indent: number): void;
}
export declare class ArrayEncodingTransformer extends Transformer {
    private readonly _itemTargetTypeRef;
    readonly itemTransformer: Transformer;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, _itemTargetTypeRef: TypeRef, itemTransformer: Transformer);
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    readonly canFail: boolean;
    readonly itemTargetType: Type;
    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    hashCode(): number;
    equals(other: any): boolean;
    protected debugPrintContinuations(indent: number): void;
}
export declare class ChoiceTransformer extends Transformer {
    readonly transformers: ReadonlyArray<Transformer>;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, transformers: ReadonlyArray<Transformer>);
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugPrintContinuations(indent: number): void;
}
export declare class DecodingChoiceTransformer extends Transformer {
    readonly nullTransformer: Transformer | undefined;
    readonly integerTransformer: Transformer | undefined;
    readonly doubleTransformer: Transformer | undefined;
    readonly boolTransformer: Transformer | undefined;
    readonly stringTransformer: Transformer | undefined;
    readonly arrayTransformer: Transformer | undefined;
    readonly objectTransformer: Transformer | undefined;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, nullTransformer: Transformer | undefined, integerTransformer: Transformer | undefined, doubleTransformer: Transformer | undefined, boolTransformer: Transformer | undefined, stringTransformer: Transformer | undefined, arrayTransformer: Transformer | undefined, objectTransformer: Transformer | undefined);
    readonly transformers: ReadonlyArray<Transformer>;
    getChildren(): Set<Type>;
    getNumberOfNodes(): number;
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugPrintContinuations(indent: number): void;
}
export declare class UnionMemberMatchTransformer extends MatchTransformer {
    readonly memberTypeRef: TypeRef;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer, memberTypeRef: TypeRef);
    readonly sourceType: UnionType;
    readonly canFail: boolean;
    readonly memberType: Type;
    getChildren(): Set<Type>;
    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugDescription(): string;
}
/**
 * This matches strings and enum cases.
 */
export declare class StringMatchTransformer extends MatchTransformer {
    readonly stringCase: string;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer, stringCase: string);
    readonly sourceType: EnumType | PrimitiveType;
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugDescription(): string;
}
export declare class UnionInstantiationTransformer extends Transformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
/**
 * Produces a string or an enum case.
 */
export declare class StringProducerTransformer extends ProducerTransformer {
    readonly result: string;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, result: string);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
    hashCode(): number;
    protected debugDescription(): string;
}
export declare class ParseStringTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class StringifyTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class MinMaxLengthCheckTransformer extends ProducerTransformer {
    readonly minLength: number | undefined;
    readonly maxLength: number | undefined;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, minLength: number | undefined, maxLength: number | undefined);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class MinMaxValueTransformer extends ProducerTransformer {
    readonly minimum: number | undefined;
    readonly maximum: number | undefined;
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, minimum: number | undefined, maximum: number | undefined);
    readonly canFail: boolean;
    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;
    equals(other: any): boolean;
}
export declare class Transformation {
    private readonly _graph;
    private readonly _targetTypeRef;
    readonly transformer: Transformer;
    constructor(_graph: TypeGraph, _targetTypeRef: TypeRef, transformer: Transformer);
    readonly sourceType: Type;
    readonly targetType: Type;
    readonly reverse: Transformation;
    getChildren(): Set<Type>;
    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformation;
    equals(other: any): boolean;
    hashCode(): number;
    debugPrint(): void;
}
export declare const transformationTypeAttributeKind: TypeAttributeKind<Transformation>;
export declare function transformationForType(t: Type): Transformation | undefined;
export declare function followTargetType(t: Type): Type;

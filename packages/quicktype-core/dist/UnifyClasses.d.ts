import { Type } from "./Type";
import { TypeBuilder } from "./TypeBuilder";
import { TypeLookerUp, GraphRewriteBuilder, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { UnionBuilder } from "./UnionBuilder";
import { TypeAttributes } from "./attributes/TypeAttributes";
import { TypeRef } from "./TypeGraph";
export declare class UnifyUnionBuilder extends UnionBuilder<BaseGraphRewriteBuilder, TypeRef[], TypeRef[]> {
    private readonly _makeObjectTypes;
    private readonly _makeClassesFixed;
    private readonly _unifyTypes;
    constructor(typeBuilder: BaseGraphRewriteBuilder, _makeObjectTypes: boolean, _makeClassesFixed: boolean, _unifyTypes: (typesToUnify: TypeRef[]) => TypeRef);
    protected makeObject(objectRefs: TypeRef[], typeAttributes: TypeAttributes, forwardingRef: TypeRef | undefined): TypeRef;
    protected makeArray(arrays: TypeRef[], typeAttributes: TypeAttributes, forwardingRef: TypeRef | undefined): TypeRef;
}
export declare function unionBuilderForUnification<T extends Type>(typeBuilder: GraphRewriteBuilder<T>, makeObjectTypes: boolean, makeClassesFixed: boolean, conflateNumbers: boolean): UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]>;
export declare function unifyTypes<T extends Type>(types: ReadonlySet<Type>, typeAttributes: TypeAttributes, typeBuilder: GraphRewriteBuilder<T>, unionBuilder: UnionBuilder<TypeBuilder & TypeLookerUp, TypeRef[], TypeRef[]>, conflateNumbers: boolean, maybeForwardingRef?: TypeRef): TypeRef;

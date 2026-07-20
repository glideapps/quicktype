import { TypeAttributeKind } from "./TypeAttributes.js";

class SchemaSetOperationTypeAttributeKind extends TypeAttributeKind<true> {
    public constructor() {
        super("schemaSetOperation");
    }

    public combine(_: true[]): true {
        return true;
    }

    public makeInferred(_: true): true {
        return true;
    }
}

export const schemaSetOperationTypeAttributeKind: TypeAttributeKind<true> =
    new SchemaSetOperationTypeAttributeKind();

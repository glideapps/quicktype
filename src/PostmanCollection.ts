"use strict";

import { JSONTypeSource } from ".";

export function sourcesFromPostmanCollection(collectionJSON: string): JSONTypeSource[] {
    const collection = Convert.toPostmanCollection(collectionJSON);
    return collection.item.map(item => ({ name: item.name, samples: item.response.map(r => r.body) }));
}

interface PostmanCollection {
    item: Item[];
}

interface Item {
    name: string;
    response: Response[];
}

interface Response {
    body: string;
}

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
module Convert {
    export function toPostmanCollection(json: string): PostmanCollection {
        return cast(JSON.parse(json), O("PostmanCollection"));
    }

    export function postmanCollectionToJson(value: PostmanCollection): string {
        return JSON.stringify(value, null, 2);
    }

    function cast<T>(obj: any, typ: any): T {
        if (!isValid(typ, obj)) {
            throw `Invalid value`;
        }
        return obj;
    }

    function isValid(typ: any, val: any): boolean {
        if (typ === undefined) return true;
        if (typ === null) return val === null || val === undefined;
        return typ.isUnion ? isValidUnion(typ.typs, val)
            : typ.isArray ? isValidArray(typ.typ, val)
                : typ.isMap ? isValidMap(typ.typ, val)
                    : typ.isEnum ? isValidEnum(typ.name, val)
                        : typ.isObject ? isValidObject(typ.cls, val)
                            : isValidPrimitive(typ, val);
    }

    function isValidPrimitive(typ: string, val: any) {
        return typeof typ === typeof val;
    }

    function isValidUnion(typs: any[], val: any): boolean {
        // val must validate against one typ in typs
        return typs.find(typ => isValid(typ, val)) !== undefined;
    }

    function isValidEnum(enumName: string, val: any): boolean {
        const cases = typeMap[enumName];
        return cases.indexOf(val) !== -1;
    }

    function isValidArray(typ: any, val: any): boolean {
        // val must be an array with no invalid elements
        return Array.isArray(val) && val.every(element => {
            return isValid(typ, element);
        });
    }

    function isValidMap(typ: any, val: any): boolean {
        if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
        // all values in the map must be typ
        return Object.keys(val).every(prop => {
            if (!Object.prototype.hasOwnProperty.call(val, prop)) return true;
            return isValid(typ, val[prop]);
        });
    }

    function isValidObject(className: string, val: any): boolean {
        if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
        let typeRep = typeMap[className];
        return Object.keys(typeRep).every(prop => {
            if (!Object.prototype.hasOwnProperty.call(typeRep, prop)) return true;
            return isValid(typeRep[prop], val[prop]);
        });
    }

    function A(typ: any) {
        return { typ, isArray: true };
    }

    function O(className: string) {
        return { cls: className, isObject: true };
    }

    const typeMap: any = {
        "PostmanCollection": {
            item: A(O("Item")),
        },
        "Item": {
            name: "",
            response: A(O("Response")),
        },
        "Response": {
            body: "",
        },
    };
}

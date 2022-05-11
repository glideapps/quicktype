export declare enum __DirectiveLocation {
    QUERY = "QUERY",
    MUTATION = "MUTATION",
    SUBSCRIPTION = "SUBSCRIPTION",
    FIELD = "FIELD",
    FRAGMENT_DEFINITION = "FRAGMENT_DEFINITION",
    FRAGMENT_SPREAD = "FRAGMENT_SPREAD",
    INLINE_FRAGMENT = "INLINE_FRAGMENT",
    SCHEMA = "SCHEMA",
    SCALAR = "SCALAR",
    OBJECT = "OBJECT",
    FIELD_DEFINITION = "FIELD_DEFINITION",
    ARGUMENT_DEFINITION = "ARGUMENT_DEFINITION",
    INTERFACE = "INTERFACE",
    UNION = "UNION",
    ENUM = "ENUM",
    ENUM_VALUE = "ENUM_VALUE",
    INPUT_OBJECT = "INPUT_OBJECT",
    INPUT_FIELD_DEFINITION = "INPUT_FIELD_DEFINITION"
}
export declare enum TypeKind {
    SCALAR = "SCALAR",
    OBJECT = "OBJECT",
    INTERFACE = "INTERFACE",
    UNION = "UNION",
    ENUM = "ENUM",
    INPUT_OBJECT = "INPUT_OBJECT",
    LIST = "LIST",
    NON_NULL = "NON_NULL"
}
export declare type GraphQLSchema = {
    __schema: {
        __typename: "__Schema";
        queryType: {
            __typename: "__Type";
            name: string | null;
        };
        mutationType: {
            __typename: "__Type";
            name: string | null;
        } | null;
        subscriptionType: {
            __typename: "__Type";
            name: string | null;
        } | null;
        types: Array<{
            __typename: "__Type";
            kind: TypeKind;
            name: string | null;
            description: string | null;
            fields: Array<{
                __typename: "__Field";
                name: string;
                description: string | null;
                args: Array<{
                    __typename: "__InputValue";
                    name: string;
                    description: string | null;
                    type: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                            ofType: {
                                                __typename: "__Type";
                                                kind: TypeKind;
                                                name: string | null;
                                                ofType: {
                                                    __typename: "__Type";
                                                    kind: TypeKind;
                                                    name: string | null;
                                                } | null;
                                            } | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    };
                    defaultValue: string | null;
                }>;
                type: {
                    __typename: "__Type";
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                            ofType: {
                                                __typename: "__Type";
                                                kind: TypeKind;
                                                name: string | null;
                                            } | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                };
                isDeprecated: boolean;
                deprecationReason: string | null;
            }> | null;
            inputFields: Array<{
                __typename: "__InputValue";
                name: string;
                description: string | null;
                type: {
                    __typename: "__Type";
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                            ofType: {
                                                __typename: "__Type";
                                                kind: TypeKind;
                                                name: string | null;
                                            } | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                };
                defaultValue: string | null;
            }> | null;
            interfaces: Array<{
                __typename: "__Type";
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: "__Type";
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            }> | null;
            enumValues: Array<{
                __typename: "__EnumValue";
                name: string;
                description: string | null;
            }> | null;
            possibleTypes: Array<{
                __typename: "__Type";
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: "__Type";
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            }> | null;
        }>;
        directives: Array<{
            __typename: "__Directive";
            name: string;
            description: string | null;
            locations: Array<__DirectiveLocation>;
            args: Array<{
                __typename: "__InputValue";
                name: string;
                description: string | null;
                type: {
                    __typename: "__Type";
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: "__Type";
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: "__Type";
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: "__Type";
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: "__Type";
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: "__Type";
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: "__Type";
                                            kind: TypeKind;
                                            name: string | null;
                                            ofType: {
                                                __typename: "__Type";
                                                kind: TypeKind;
                                                name: string | null;
                                            } | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                };
                defaultValue: string | null;
            }>;
        }>;
    };
};
export declare type FullTypeFragment = {
    __typename: "__Type";
    kind: TypeKind;
    name: string | null;
    description: string | null;
    fields: Array<{
        __typename: string;
        name: string;
        description: string | null;
        args: Array<{
            __typename: string;
            name: string;
            description: string | null;
            type: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: string;
                                        kind: TypeKind;
                                        name: string | null;
                                        ofType: {
                                            __typename: string;
                                            kind: TypeKind;
                                            name: string | null;
                                        } | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            };
            defaultValue: string | null;
        }>;
        type: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: string;
                                        kind: TypeKind;
                                        name: string | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        };
        isDeprecated: boolean;
        deprecationReason: string | null;
    }> | null;
    inputFields: Array<{
        __typename: string;
        name: string;
        description: string | null;
        type: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                    ofType: {
                                        __typename: string;
                                        kind: TypeKind;
                                        name: string | null;
                                    } | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        };
        defaultValue: string | null;
    }> | null;
    interfaces: Array<{
        __typename: string;
        kind: TypeKind;
        name: string | null;
        ofType: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        } | null;
    }> | null;
    enumValues: Array<{
        __typename: string;
        name: string;
        description: string | null;
    }> | null;
    possibleTypes: Array<{
        __typename: string;
        kind: TypeKind;
        name: string | null;
        ofType: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        } | null;
    }> | null;
};
export declare type InputValueFragment = {
    __typename: "__InputValue";
    name: string;
    description: string | null;
    type: {
        __typename: string;
        kind: TypeKind;
        name: string | null;
        ofType: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                                ofType: {
                                    __typename: string;
                                    kind: TypeKind;
                                    name: string | null;
                                } | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        } | null;
    };
    defaultValue: string | null;
};
export declare type TypeRefFragment = {
    __typename: "__Type";
    kind: TypeKind;
    name: string | null;
    ofType: {
        __typename: string;
        kind: TypeKind;
        name: string | null;
        ofType: {
            __typename: string;
            kind: TypeKind;
            name: string | null;
            ofType: {
                __typename: string;
                kind: TypeKind;
                name: string | null;
                ofType: {
                    __typename: string;
                    kind: TypeKind;
                    name: string | null;
                    ofType: {
                        __typename: string;
                        kind: TypeKind;
                        name: string | null;
                        ofType: {
                            __typename: string;
                            kind: TypeKind;
                            name: string | null;
                            ofType: {
                                __typename: string;
                                kind: TypeKind;
                                name: string | null;
                            } | null;
                        } | null;
                    } | null;
                } | null;
            } | null;
        } | null;
    } | null;
};

module Main where

import Prelude

import Data.Argonaut.Core (Json, foldJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Array (concatMap, foldMap, (!!), (:))
import Data.Either (Either)
import Data.Maybe (fromJust)
import Data.StrMap (StrMap, foldMap, fromFoldable, toUnfoldable, values) as StrMap
import Data.Tuple (Tuple(Tuple))
import Partial.Unsafe (unsafePartial)

type IRClassData = { name :: String, properties :: StrMap.StrMap IRType }

data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass IRClassData
    | IRUnion (Array IRType)

makeTypeFromJson :: String -> Json -> IRType
makeTypeFromJson name json = foldJson
    (const IRNull)
    (const IRBool)
    (const IRDouble)
    (const IRString)
    (case _ of
        [] -> IRArray IRNothing
        a ->
            let elementType = makeTypeFromJson (singularize name) (unsafePartial $ fromJust $ a !! 0) in
            IRArray elementType)
    (\o -> IRClass { name, properties: mapProperties o })
    json

mapProperties :: StrMap.StrMap Json -> StrMap.StrMap IRType
mapProperties sm = StrMap.fromFoldable results
  where mapper (Tuple n j) = Tuple n (makeTypeFromJson n j)
        results = map mapper (unfold sm)

singularize :: String -> String
singularize s = "OneOf" <> s

-- This is a travesty.  Try putting this function definition
-- in the where clause below.
unfold :: forall a. StrMap.StrMap a -> Array (Tuple String a)
unfold sm = StrMap.toUnfoldable sm

gatherClassesFromType :: IRType -> Array IRClassData
gatherClassesFromType (IRClass classData) =
    let { name, properties } = classData in
    classData : (concatMap gatherClassesFromType (StrMap.values properties))
gatherClassesFromType (IRArray t) = gatherClassesFromType t
gatherClassesFromType _ = []

renderTypeToCSharp :: IRType -> String
renderTypeToCSharp IRNothing = "object"
renderTypeToCSharp IRNull = "object"
renderTypeToCSharp IRInteger = "int"
renderTypeToCSharp IRDouble = "double"
renderTypeToCSharp IRBool = "bool"
renderTypeToCSharp IRString = "string"
renderTypeToCSharp (IRArray a) = (renderTypeToCSharp a) <> "[]"
renderTypeToCSharp (IRClass { name }) = name
renderTypeToCSharp (IRUnion _) = "FIXME"

renderClassToCSharp :: IRClassData -> String
renderClassToCSharp { name, properties } =
    "class " <> name <> """
{""" <>
    StrMap.foldMap (\n -> \t -> "\n" <> nameToProperty n t) properties
    <> """
}
"""
    where nameToProperty name irType = "    public " <> (renderTypeToCSharp irType) <> " " <> name <> " { get; set; }"

renderClassesToCSharp :: Array IRClassData -> String
renderClassesToCSharp classes =
    foldMap (\c -> (renderClassToCSharp c) <> "\n\n") classes

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeFromJson "TopLevel"
    <#> gatherClassesFromType
    <#> renderClassesToCSharp
